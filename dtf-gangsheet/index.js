import express from "express";
import multer from "multer";
import { PDFDocument } from "pdf-lib";
import archiver from "archiver";

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

const PORT = process.env.PORT || 8080;

// Constants
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

    log(`Requested quantity: ${quantity}, rotate: ${rotate}`);
    log(`Uploaded PDF size: ${uploadedFile.size} bytes`);

    // Load uploaded PDF
    const uploadedPdf = await PDFDocument.load(uploadedFile.buffer);
    const uploadedPage = uploadedPdf.getPages()[0];
    let { width: logoWidth, height: logoHeight } = uploadedPage.getSize();

    if (rotate) [logoWidth, logoHeight] = [logoHeight, logoWidth];

    const safeMarginPts = SAFE_MARGIN_INCH * POINTS_PER_INCH;
    const spacingPts = SPACING_INCH * POINTS_PER_INCH;

    const sheetWidthPts = SHEET_WIDTH_INCH * POINTS_PER_INCH;
    const maxHeightPts = MAX_SHEET_HEIGHT_INCH * POINTS_PER_INCH;

    const logoTotalWidth = logoWidth + spacingPts;
    const logoTotalHeight = logoHeight + spacingPts;

    // logos per row
    const logosPerRow = Math.floor(
      (sheetWidthPts - safeMarginPts * 2 + spacingPts) / logoTotalWidth
    );
    if (logosPerRow < 1) throw new Error("Logo too wide for sheet");
    log(`Can fit ${logosPerRow} per row`);

    // rows per sheet
    const rowsPerSheet = Math.floor(
      (maxHeightPts - safeMarginPts * 2 + spacingPts) / logoTotalHeight
    );
    const logosPerSheet = logosPerRow * rowsPerSheet;

    log(
      `Each sheet max ${rowsPerSheet} rows → ${logosPerSheet} logos max per sheet`
    );

    const totalSheetsNeeded = Math.ceil(quantity / logosPerSheet);
    log(`Total sheets needed: ${totalSheetsNeeded}`);

    // ✅ SINGLE-SHEET MODE
    if (totalSheetsNeeded === 1) {
      const pdfDoc = await PDFDocument.create();
      const [embeddedPage] = await pdfDoc.embedPdf(uploadedFile.buffer);

      // Compute how many rows will actually be used
      const usedRows = Math.ceil(quantity / logosPerRow);
      const usedHeightPts =
        usedRows * logoTotalHeight + safeMarginPts * 2 - spacingPts;
      const roundedHeightPts =
        Math.ceil(usedHeightPts / POINTS_PER_INCH) * POINTS_PER_INCH;

      // Create final page at correct height BEFORE drawing
      const page = pdfDoc.addPage([sheetWidthPts, roundedHeightPts]);

      let yCursor = roundedHeightPts - safeMarginPts - logoHeight;
      let placed = 0;

      while (placed < quantity) {
        let xCursor = safeMarginPts;
        for (let c = 0; c < logosPerRow && placed < quantity; c++) {
          page.drawPage(embeddedPage, { x: xCursor, y: yCursor });
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
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="gangsheets.zip"`
    );

    const archive = archiver("zip");
    archive.pipe(res);

    let remaining = quantity;

    for (let sheetIndex = 0; sheetIndex < totalSheetsNeeded; sheetIndex++) {
      log(`Generating sheet ${sheetIndex + 1}/${totalSheetsNeeded}...`);

      const sheetDoc = await PDFDocument.create();
      const [embeddedPage] = await sheetDoc.embedPdf(uploadedFile.buffer);

      const logosOnThisSheet = Math.min(remaining, logosPerSheet);
      const usedRows = Math.ceil(logosOnThisSheet / logosPerRow);
      const usedHeightPts =
        usedRows * logoTotalHeight + safeMarginPts * 2 - spacingPts;
      const roundedHeightPts =
        Math.ceil(usedHeightPts / POINTS_PER_INCH) * POINTS_PER_INCH;

      // Create this sheet page at correct height BEFORE drawing ✅
      const page = sheetDoc.addPage([sheetWidthPts, roundedHeightPts]);

      let yCursor = roundedHeightPts - safeMarginPts - logoHeight;
      let drawn = 0;

      while (drawn < logosOnThisSheet) {
        let xCursor = safeMarginPts;
        for (let c = 0; c < logosPerRow && drawn < logosOnThisSheet; c++) {
          page.drawPage(embeddedPage, { x: xCursor, y: yCursor });
          drawn++;
          remaining--;
          xCursor += logoTotalWidth;
        }
        yCursor -= logoTotalHeight;
      }

      const pdfBytes = await sheetDoc.save(); // returns Uint8Array
      const pdfBuffer = Buffer.from(pdfBytes); // convert to Node Buffer ✅

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
