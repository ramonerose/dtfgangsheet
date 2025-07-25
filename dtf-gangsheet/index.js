import express from "express";
import multer from "multer";
import { PDFDocument, degrees } from "pdf-lib";
import archiver from "archiver";

const app = express();
const upload = multer({ storage: multer.memoryStorage() });
const PORT = process.env.PORT || 8080;

// ✅ Sheet & spacing constants
const SHEET_WIDTH_INCH = 22;
const MAX_SHEET_HEIGHT_INCH = 200;
const POINTS_PER_INCH = 72;
const SAFE_MARGIN_INCH = 0.125;
const SPACING_INCH = 0.5;

// ✅ Cost lookup table
const costTable = {
  12: 5.28,
  24: 10.56,
  36: 15.84,
  48: 21.12,
  60: 26.40,
  80: 35.20,
  100: 44.00,
  120: 49.28,
  140: 56.32,
  160: 61.60,
  180: 68.64,
  200: 75.68,
};

// ✅ Find the nearest height tier (round up)
function getSheetCost(heightInches) {
  const tiers = Object.keys(costTable).map(Number).sort((a, b) => a - b);
  for (let tier of tiers) {
    if (heightInches <= tier) {
      return { tier, cost: costTable[tier] };
    }
  }
  return { tier: 200, cost: costTable[200] }; // default max
}

app.use(express.static("public"));

function log(msg) {
  console.log(`[DEBUG] ${msg}`);
}

app.post("/merge", upload.single("file"), async (req, res) => {
  try {
    log("/merge route hit!");

    const quantity = parseInt(req.body.quantity, 10);
    const rotate = req.body.rotate === "true";
    const uploadedFile = req.file;

    if (!uploadedFile) throw new Error("No file uploaded");
    if (!quantity || quantity <= 0) throw new Error("Invalid quantity");

    log(`Requested quantity: ${quantity}, rotate: ${rotate}`);
    log(`Uploaded PDF size: ${uploadedFile.size} bytes`);

    // ✅ Load uploaded PDF
    const uploadedPdf = await PDFDocument.load(uploadedFile.buffer);
    const uploadedPage = uploadedPdf.getPages()[0];
    let { width: logoWidth, height: logoHeight } = uploadedPage.getSize();

    // ✅ Swap width/height if rotating
    let layoutWidth = logoWidth;
    let layoutHeight = logoHeight;
    if (rotate) [layoutWidth, layoutHeight] = [logoHeight, logoWidth];

    const safeMarginPts = SAFE_MARGIN_INCH * POINTS_PER_INCH;
    const spacingPts = SPACING_INCH * POINTS_PER_INCH;

    const sheetWidthPts = SHEET_WIDTH_INCH * POINTS_PER_INCH;
    const maxHeightPts = MAX_SHEET_HEIGHT_INCH * POINTS_PER_INCH;

    const logoTotalWidth = layoutWidth + spacingPts;
    const logoTotalHeight = layoutHeight + spacingPts;

    const logosPerRow = Math.floor(
      (sheetWidthPts - safeMarginPts * 2 + spacingPts) / logoTotalWidth
    );
    if (logosPerRow < 1) throw new Error("Logo too wide for sheet");
    log(`Can fit ${logosPerRow} per row`);

    const rowsPerSheet = Math.floor(
      (maxHeightPts - safeMarginPts * 2 + spacingPts) / logoTotalHeight
    );
    const logosPerSheet = logosPerRow * rowsPerSheet;
    log(`Each sheet max ${rowsPerSheet} rows → ${logosPerSheet} logos`);

    const totalSheetsNeeded = Math.ceil(quantity / logosPerSheet);
    log(`Total sheets needed: ${totalSheetsNeeded}`);

    // ✅ Helper to draw logo w/ rotation
    const drawLogo = (page, embeddedPage, x, y) => {
      if (rotate) {
        page.drawPage(embeddedPage, {
          x: x + logoHeight,
          y,
          rotate: degrees(90),
        });
      } else {
        page.drawPage(embeddedPage, { x, y });
      }
    };

    // ✅ Single-sheet mode
    if (totalSheetsNeeded === 1) {
      const pdfDoc = await PDFDocument.create();
      const [embeddedPage] = await pdfDoc.embedPdf(uploadedFile.buffer);

      const usedRows = Math.ceil(quantity / logosPerRow);
      const usedHeightPts =
        usedRows * logoTotalHeight + safeMarginPts * 2 - spacingPts;
      const roundedHeightPts =
        Math.ceil(usedHeightPts / POINTS_PER_INCH) * POINTS_PER_INCH;
      const roundedHeightInches = Math.ceil(roundedHeightPts / POINTS_PER_INCH);

      const page = pdfDoc.addPage([sheetWidthPts, roundedHeightPts]);

      let yCursor = roundedHeightPts - safeMarginPts - layoutHeight;
      let placed = 0;

      while (placed < quantity) {
        let xCursor = safeMarginPts;
        for (let c = 0; c < logosPerRow && placed < quantity; c++) {
          drawLogo(page, embeddedPage, xCursor, yCursor);
          placed++;
          xCursor += logoTotalWidth;
        }
        yCursor -= logoTotalHeight;
      }

      const pdfBytes = await pdfDoc.save();
      const { cost } = getSheetCost(roundedHeightInches);

      res.setHeader("Content-Type", "application/json");
      return res.json({
        type: "single",
        filename: `gangsheet_${SHEET_WIDTH_INCH}x${roundedHeightInches}.pdf`,
        pdf: Buffer.from(pdfBytes).toString("base64"),
        sheetHeight: roundedHeightInches,
        cost,
        totalCost: cost,
      });
    }

    // ✅ Multi-sheet mode
    log(`Multi-sheet mode triggered`);
    let remaining = quantity;
    const sheetSummaries = [];
    const zipBuffers = [];

    for (let sheetIndex = 0; sheetIndex < totalSheetsNeeded; sheetIndex++) {
      const sheetDoc = await PDFDocument.create();
      const [embeddedPage] = await sheetDoc.embedPdf(uploadedFile.buffer);

      const logosOnThisSheet = Math.min(remaining, logosPerSheet);
      const usedRows = Math.ceil(logosOnThisSheet / logosPerRow);
      const usedHeightPts =
        usedRows * logoTotalHeight + safeMarginPts * 2 - spacingPts;
      const roundedHeightPts =
        Math.ceil(usedHeightPts / POINTS_PER_INCH) * POINTS_PER_INCH;
      const roundedHeightInches = Math.ceil(roundedHeightPts / POINTS_PER_INCH);

      const page = sheetDoc.addPage([sheetWidthPts, roundedHeightPts]);

      let yCursor = roundedHeightPts - safeMarginPts - layoutHeight;
      let drawn = 0;

      while (drawn < logosOnThisSheet) {
        let xCursor = safeMarginPts;
        for (let c = 0; c < logosPerRow && drawn < logosOnThisSheet; c++) {
          drawLogo(page, embeddedPage, xCursor, yCursor);
          drawn++;
          remaining--;
          xCursor += logoTotalWidth;
        }
        yCursor -= logoTotalHeight;
      }

      const pdfBytes = await sheetDoc.save();
      const buffer = Buffer.from(pdfBytes);
      zipBuffers.push({
        filename: `gangsheet_${SHEET_WIDTH_INCH}x${roundedHeightInches}.pdf`,
        buffer,
      });

      const { cost } = getSheetCost(roundedHeightInches);
      sheetSummaries.push({
        height: roundedHeightInches,
        cost,
      });
    }

    const totalCost = sheetSummaries.reduce((sum, s) => sum + s.cost, 0);

    // ✅ Instead of sending ZIP, just send metadata + base64 sheets (frontend can download)
    res.json({
      type: "multi",
      sheets: sheetSummaries,
      totalCost,
      zipSheets: zipBuffers.map((z) => ({
        filename: z.filename,
        pdf: z.buffer.toString("base64"),
      })),
    });
  } catch (err) {
    console.error("MERGE ERROR:", err);
    res.status(500).send(`Server error: ${err.message}`);
  }
});

app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
});
