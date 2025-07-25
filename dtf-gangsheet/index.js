import express from "express";
import multer from "multer";
import { PDFDocument, degrees } from "pdf-lib";
import archiver from "archiver";
import path from "path";
import fs from "fs";

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

const PORT = process.env.PORT || 8080;

// Constants
const SHEET_WIDTH_INCH = 22;
const MAX_SHEET_HEIGHT_INCH = 200;
const POINTS_PER_INCH = 72;
const SAFE_MARGIN_INCH = 0.125;
const SPACING_INCH = 0.5;

// Temporary storage for generated PDFs (in-memory for now)
let lastGeneratedSheets = [];

app.use(express.static("public"));
app.use(express.json());

function log(msg) {
  console.log(`[DEBUG] ${msg}`);
}

// Predefined costs for each sheet size
const sheetCosts = {
  "22x12": 5.28,
  "22x24": 10.56,
  "22x36": 15.84,
  "22x48": 21.12,
  "22x60": 26.40,
  "22x80": 35.20,
  "22x100": 44.00,
  "22x120": 49.28,
  "22x140": 56.32,
  "22x160": 61.60,
  "22x180": 68.64,
  "22x200": 75.68,
};

function findClosestCostLabel(heightInch) {
  const availableHeights = Object.keys(sheetCosts).map((k) => parseInt(k.split("x")[1]));
  let closest = availableHeights[0];

  for (let h of availableHeights) {
    if (heightInch <= h) {
      closest = h;
      break;
    }
  }
  return `22x${closest}`;
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

    const uploadedPdf = await PDFDocument.load(uploadedFile.buffer);
    const uploadedPage = uploadedPdf.getPages()[0];
    let { width: logoWidth, height: logoHeight } = uploadedPage.getSize();

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

    log(
      `Each sheet max ${rowsPerSheet} rows → ${logosPerSheet} logos max per sheet`
    );

    const totalSheetsNeeded = Math.ceil(quantity / logosPerSheet);
    log(`Total sheets needed: ${totalSheetsNeeded}`);

    const generatedSheets = [];
    let remaining = quantity;

    for (let sheetIndex = 0; sheetIndex < totalSheetsNeeded; sheetIndex++) {
      const sheetDoc = await PDFDocument.create();
      const [embeddedPage] = await sheetDoc.embedPdf(uploadedFile.buffer);

      const logosOnThisSheet = Math.min(remaining, logosPerSheet);
      const usedRows = Math.ceil(logosOnThisSheet / logosPerRow);
      const usedHeightPts =
        usedRows * logoTotalHeight + safeMarginPts * 2 - spacingPts;
      const roundedHeightPts =
        Math.ceil(usedHeightPts / POINTS_PER_INCH) * POINTS_PER_INCH;

      const page = sheetDoc.addPage([sheetWidthPts, roundedHeightPts]);

      let yCursor = roundedHeightPts - safeMarginPts - layoutHeight;
      let drawn = 0;

      while (drawn < logosOnThisSheet) {
        let xCursor = safeMarginPts;
        for (let c = 0; c < logosPerRow && drawn < logosOnThisSheet; c++) {
          if (rotate) {
            page.drawPage(embeddedPage, {
              x: xCursor + logoHeight,
              y: yCursor,
              rotate: degrees(90),
            });
          } else {
            page.drawPage(embeddedPage, { x: xCursor, y: yCursor });
          }
          drawn++;
          remaining--;
          xCursor += logoTotalWidth;
        }
        yCursor -= logoTotalHeight;
      }

      const pdfBytes = await sheetDoc.save();
      const pdfBuffer = Buffer.from(pdfBytes);

      const finalHeightInch = Math.ceil(roundedHeightPts / POINTS_PER_INCH);
      const label = findClosestCostLabel(finalHeightInch);
      const cost = sheetCosts[label] ?? 0;
      const filename = `gangsheet_${SHEET_WIDTH_INCH}x${finalHeightInch}.pdf`;

      generatedSheets.push({
        name: filename,
        cost,
        buffer: pdfBuffer.toString("base64"), // store as base64 for frontend
      });
    }

    lastGeneratedSheets = generatedSheets;

    const totalCost = generatedSheets.reduce((sum, s) => sum + s.cost, 0);

    res.json({ sheets: generatedSheets, totalCost });
  } catch (err) {
    console.error("MERGE ERROR:", err);
    res.status(500).send(`Server error: ${err.message}`);
  }
});

// ✅ NEW ENDPOINT: Download All Sheets as ZIP
app.get("/download-all", async (req, res) => {
  if (!lastGeneratedSheets.length) {
    return res.status(400).send("No sheets generated yet");
  }

  res.setHeader("Content-Type", "application/zip");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="all_sheets.zip"`
  );

  const archive = archiver("zip");
  archive.pipe(res);

  lastGeneratedSheets.forEach((sheet) => {
    archive.append(Buffer.from(sheet.buffer, "base64"), { name: sheet.name });
  });

  archive.finalize();
});

app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
});
