import express from "express";
import multer from "multer";
import { PDFDocument, degrees } from "pdf-lib";
import archiver from "archiver";

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

const PORT = process.env.PORT || 8080;

const SHEET_WIDTH_INCH = 22;
const MAX_SHEET_HEIGHT_INCH = 200;
const POINTS_PER_INCH = 72;
const SAFE_MARGIN_INCH = 0.125;
const SPACING_INCH = 0.5;

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

    const originalName = uploadedFile.originalname.toLowerCase();
    if (!originalName.endsWith(".pdf")) {
      throw new Error("Only PDF uploads supported in this stable version");
    }

    log(`Uploaded PDF: ${uploadedFile.originalname}`);
    log(`Requested quantity: ${quantity}, rotate: ${rotate}`);

    const safeMarginPts = SAFE_MARGIN_INCH * POINTS_PER_INCH;
    const spacingPts = SPACING_INCH * POINTS_PER_INCH;

    const sheetWidthPts = SHEET_WIDTH_INCH * POINTS_PER_INCH;
    const maxHeightPts = MAX_SHEET_HEIGHT_INCH * POINTS_PER_INCH;

    // ✅ Extract the uploaded PDF page
    const sourceDoc = await PDFDocument.load(uploadedFile.buffer);
    const [firstPage] = await sourceDoc.copyPages(sourceDoc, [0]);
    const logoWidthPts = firstPage.getWidth();
    const logoHeightPts = firstPage.getHeight();
    log(`Source logo size: ${logoWidthPts} x ${logoHeightPts} pts`);

    const logoTotalWidth = logoWidthPts + spacingPts;
    const logoTotalHeight = logoHeightPts + spacingPts;

    const logosPerRow = Math.floor(
      (sheetWidthPts - safeMarginPts * 2 + spacingPts) / logoTotalWidth
    );
    if (logosPerRow < 1) throw new Error("Logo too wide for sheet");
    log(`Can fit ${logosPerRow} per row`);

    const rowsPerSheet = Math.floor(
      (maxHeightPts - safeMarginPts * 2 + spacingPts) / logoTotalHeight
    );
    const logosPerSheet = logosPerRow * rowsPerSheet;
    log(`Each sheet max ${rowsPerSheet} rows -> ${logosPerSheet} logos max per sheet`);

    const totalSheetsNeeded = Math.ceil(quantity / logosPerSheet);
    log(`Total sheets needed: ${totalSheetsNeeded}`);

    // ✅ drawLogo now only handles PDFs (rotate if needed)
    const drawLogo = (page, embeddedPage, x, y) => {
      if (rotate) {
        page.drawPage(embeddedPage, {
          x,
          y,
          width: logoHeightPts,
          height: logoWidthPts,
          rotate: degrees(90)
        });
      } else {
        page.drawPage(embeddedPage, {
          x,
          y,
          width: logoWidthPts,
          height: logoHeightPts
        });
      }
    };

    // ✅ SINGLE-SHEET MODE
    if (totalSheetsNeeded === 1) {
      const pdfDoc = await PDFDocument.create();
      const page = pdfDoc.addPage();

      // Height based on required rows
      const usedRows = Math.ceil(quantity / logosPerRow);
      const usedHeightPts =
        usedRows * logoTotalHeight + safeMarginPts * 2 - spacingPts;
      const roundedHeightPts =
        Math.ceil(usedHeightPts / POINTS_PER_INCH) * POINTS_PER_INCH;

      page.setSize(sheetWidthPts, roundedHeightPts);

      let yCursor = roundedHeightPts - safeMarginPts - logoHeightPts;
      let placed = 0;

      while (placed < quantity) {
        let xCursor = safeMarginPts;
        for (let c = 0; c < logosPerRow && placed < quantity; c++) {
          drawLogo(page, firstPage, xCursor, yCursor);
          placed++;
          xCursor += logoTotalWidth;
        }
        yCursor -= logoTotalHeight;
      }

      const pdfBytes = await pdfDoc.save();
      const finalHeightInch = Math.ceil(roundedHeightPts / POINTS_PER_INCH);

      const filename = `gangsheet_${SHEET_WIDTH_INCH}x${finalHeightInch}.pdf`;
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      return res.send(Buffer.from(pdfBytes));
    }

    // ✅ MULTI-SHEET MODE
    log(`Multi-sheet mode triggered with ${totalSheetsNeeded} sheets`);
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="gangsheets.zip"`);
    const archive = archiver("zip");
    archive.pipe(res);

    let remaining = quantity;

    for (let sheetIndex = 0; sheetIndex < totalSheetsNeeded; sheetIndex++) {
      log(`Generating sheet ${sheetIndex + 1}/${totalSheetsNeeded}...`);

      const sheetDoc = await PDFDocument.create();
      const logosOnThisSheet = Math.min(remaining, logosPerSheet);

      const usedRows = Math.ceil(logosOnThisSheet / logosPerRow);
      const usedHeightPts =
        usedRows * logoTotalHeight + safeMarginPts * 2 - spacingPts;
      const roundedHeightPts =
        Math.ceil(usedHeightPts / POINTS_PER_INCH) * POINTS_PER_INCH;

      const page = sheetDoc.addPage([sheetWidthPts, roundedHeightPts]);
      let yCursor = roundedHeightPts - safeMarginPts - logoHeightPts;
      let drawn = 0;

      while (drawn < logosOnThisSheet) {
        let xCursor = safeMarginPts;
        for (let c = 0; c < logosPerRow && drawn < logosOnThisSheet; c++) {
          drawLogo(page, firstPage, xCursor, yCursor);
          drawn++;
          remaining--;
          xCursor += logoTotalWidth;
        }
        yCursor -= logoTotalHeight;
      }

      const pdfBytes = await sheetDoc.save();
      const pdfBuffer = Buffer.from(pdfBytes);
      const finalHeightInch = Math.ceil(roundedHeightPts / POINTS_PER_INCH);
      const filename = `gangsheet_${SHEET_WIDTH_INCH}x${finalHeightInch}.pdf`;

      log(`Appending ${filename} with ${logosOnThisSheet} logos`);
      archive.append(pdfBuffer, { name: filename });
    }

    archive.finalize();
  } catch (err) {
    console.error("MERGE ERROR:", err);
    res.status(500).send(`Server error: ${err.message}`);
  }
});

app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
});
