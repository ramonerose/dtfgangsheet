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
const POINTS_PER_INCH = 72; // pdf-lib uses points
const SAFE_MARGIN_INCH = 0.125;
const SPACING_INCH = 0.5;

app.use(express.static("public"));

// Helper to log consistently
function log(msg) {
  console.log(`[DEBUG] ${msg}`);
}

// MAIN ROUTE
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

    // Load the uploaded PDF
    const uploadedPdf = await PDFDocument.load(uploadedFile.buffer);
    const uploadedPage = uploadedPdf.getPages()[0];
    let { width: logoWidth, height: logoHeight } = uploadedPage.getSize();

    // Rotate if needed
    if (rotate) [logoWidth, logoHeight] = [logoHeight, logoWidth];

    const safeMarginPts = SAFE_MARGIN_INCH * POINTS_PER_INCH;
    const spacingPts = SPACING_INCH * POINTS_PER_INCH;

    const sheetWidthPts = SHEET_WIDTH_INCH * POINTS_PER_INCH;
    const maxHeightPts = MAX_SHEET_HEIGHT_INCH * POINTS_PER_INCH;

    const logoTotalWidth = logoWidth + spacingPts;
    const logoTotalHeight = logoHeight + spacingPts;

    // How many logos per row?
    const logosPerRow = Math.floor(
      (sheetWidthPts - safeMarginPts * 2 + spacingPts) / logoTotalWidth
    );
    if (logosPerRow < 1) throw new Error("Logo too wide for sheet");
    log(`Can fit ${logosPerRow} per row`);

    // How many rows fit per sheet?
    const rowsPerSheet = Math.floor(
      (maxHeightPts - safeMarginPts * 2 + spacingPts) / logoTotalHeight
    );
    const logosPerSheet = logosPerRow * rowsPerSheet;

    log(
      `Each sheet max ${rowsPerSheet} rows → ${logosPerSheet} logos max per sheet`
    );

    const totalSheetsNeeded = Math.ceil(quantity / logosPerSheet);
    log(`Total sheets needed: ${totalSheetsNeeded}`);

    // Single-sheet mode? Easy ✅
    if (totalSheetsNeeded === 1) {
      const pdfDoc = await PDFDocument.create();
      const [embeddedPage] = await pdfDoc.embedPdf(uploadedFile.buffer);

      let placed = 0;
      let yCursor =
        maxHeightPts - safeMarginPts - logoHeight; // top-down placement

      while (placed < quantity) {
        let xCursor = safeMarginPts;
        for (let c = 0; c < logosPerRow && placed < quantity; c++) {
          pdfDoc.addPage([sheetWidthPts, maxHeightPts]);
          const page = pdfDoc.getPages()[0];
          page.drawPage(embeddedPage, { x: xCursor, y: yCursor });
          placed++;
          xCursor += logoTotalWidth;
        }
        yCursor -= logoTotalHeight;
      }

      // Round up final height
      const usedRows = Math.ceil(quantity / logosPerRow);
      const usedHeightPts =
        usedRows * logoTotalHeight + safeMarginPts * 2 - spacingPts;
      const roundedHeightPts =
        Math.ceil(usedHeightPts / POINTS_PER_INCH) * POINTS_PER_INCH;

      const finalPage = pdfDoc.getPages()[0];
      finalPage.setSize(sheetWidthPts, roundedHeightPts);

      const pdfBytes = await pdfDoc.save();
      const finalHeightInch = Math.ceil(
        roundedHeightPts / POINTS_PER_INCH
      );

      const filename = `gangsheet_${SHEET_WIDTH_INCH}x${finalHeightInch}.pdf`;
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      return res.send(Buffer.from(pdfBytes));
    }

    // MULTI-SHEET MODE 🚀
    log(`Multi-sheet mode triggered with ${totalSheetsNeeded} sheets`);

    // Init archive for ZIP
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

      const page = sheetDoc.addPage([sheetWidthPts, maxHeightPts]);

      let placed = 0;
      let yCursor =
        maxHeightPts - safeMarginPts - logoHeight; // top-down placement

      const logosOnThisSheet = Math.min(remaining, logosPerSheet);

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

      // Compute height actually used
      const usedRows = Math.ceil(logosOnThisSheet / logosPerRow);
      const usedHeightPts =
        usedRows * logoTotalHeight + safeMarginPts * 2 - spacingPts;
      const roundedHeightPts =
        Math.ceil(usedHeightPts / POINTS_PER_INCH) * POINTS_PER_INCH;

      page.setSize(sheetWidthPts, roundedHeightPts);

      // Save this sheet as Buffer
      const pdfBytes = await sheetDoc.save(); // returns Uint8Array
      const pdfBuffer = Buffer.from(pdfBytes); // ✅ fix: convert to Node Buffer

      const finalHeightInch = Math.ceil(
        roundedHeightPts / POINTS_PER_INCH
      );
      const filename = `gangsheet_${SHEET_WIDTH_INCH}x${finalHeightInch}.pdf`;

      log(`Appending ${filename} to ZIP`);
      archive.append(pdfBuffer, { name: filename });
    }

    archive.finalize();
  } catch (err) {
    console.error("MERGE ERROR:", err);
    res.status(500).send(`Server error: ${err.message}`);
  }
});

// START SERVER
app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
});
