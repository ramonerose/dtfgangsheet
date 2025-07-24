import express from "express";
import multer from "multer";
import { PDFDocument } from "pdf-lib";
import archiver from "archiver";
import sharp from "sharp";
import { fromBuffer } from "pdf2pic"; // ✅ PDF → PNG converter

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

const PORT = process.env.PORT || 8080;

const SHEET_WIDTH_INCH = 22;
const MAX_SHEET_HEIGHT_INCH = 200;
const POINTS_PER_INCH = 72;
const SAFE_MARGIN_INCH = 0.125;
const SPACING_INCH = 0.5;
const PNG_DEFAULT_DPI = 300;

app.use(express.static("public"));

function log(msg) {
  console.log(`[DEBUG] ${msg}`);
}

// ✅ Rotate any PNG buffer
async function rotateIfNeeded(buffer, rotateFlag) {
  if (!rotateFlag) return buffer;
  log("Rotating image 90° clockwise...");
  return await sharp(buffer).rotate(90).toBuffer();
}

// ✅ Convert PDF → PNG buffer at 300 DPI
async function convertPdfToPngBuffer(pdfBuffer) {
  log("Converting PDF to PNG (300 DPI)...");
  const converter = fromBuffer(pdfBuffer, {
    density: PNG_DEFAULT_DPI,
    format: "png",
    width: undefined,
    height: undefined,
    saveFilename: "temp",
    savePath: "/tmp"
  });

  const pngPage = await converter(1, { responseType: "buffer" });
  const pngBuffer = pngPage.buffer;
  log("PDF → PNG conversion done.");
  return pngBuffer;
}

// ✅ Extract PNG dimensions (in points)
async function getPngDimensions(buffer) {
  const metadata = await sharp(buffer).metadata();
  const widthInches = metadata.width / PNG_DEFAULT_DPI;
  const heightInches = metadata.height / PNG_DEFAULT_DPI;
  const widthPts = widthInches * POINTS_PER_INCH;
  const heightPts = heightInches * POINTS_PER_INCH;
  log(`Image size: ${widthInches.toFixed(2)}" x ${heightInches.toFixed(2)}"`);
  return { widthPts, heightPts };
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
    const isPNG = originalName.endsWith(".png");
    const isPDF = originalName.endsWith(".pdf");

    log(`Uploaded: ${uploadedFile.originalname} | PNG? ${isPNG} | PDF? ${isPDF}`);
    log(`Requested quantity: ${quantity}, rotate: ${rotate}`);

    let finalPngBuffer;

    if (isPDF) {
      // ✅ Step 1: Convert PDF → PNG
      const convertedPng = await convertPdfToPngBuffer(uploadedFile.buffer);
      // ✅ Step 2: Rotate if requested
      finalPngBuffer = await rotateIfNeeded(convertedPng, rotate);
    } else if (isPNG) {
      // ✅ Already PNG, just rotate if needed
      finalPngBuffer = await rotateIfNeeded(uploadedFile.buffer, rotate);
    } else {
      throw new Error("Unsupported file type. Please upload PDF or PNG.");
    }

    // ✅ Get normalized PNG size
    const { widthPts: logoWidthPts, heightPts: logoHeightPts } = await getPngDimensions(finalPngBuffer);

    const safeMarginPts = SAFE_MARGIN_INCH * POINTS_PER_INCH;
    const spacingPts = SPACING_INCH * POINTS_PER_INCH;

    const sheetWidthPts = SHEET_WIDTH_INCH * POINTS_PER_INCH;
    const maxHeightPts = MAX_SHEET_HEIGHT_INCH * POINTS_PER_INCH;

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

    // ✅ Now always embed as PNG
    const embedFunc = async (doc) => {
      return await doc.embedPng(finalPngBuffer);
    };

    // ✅ drawLogo is always a simple image draw now
    const drawLogo = (page, embeddedAsset, x, y) => {
      page.drawImage(embeddedAsset, {
        x,
        y,
        width: logoWidthPts,
        height: logoHeightPts
      });
    };

    // ✅ SINGLE-SHEET MODE
    if (totalSheetsNeeded === 1) {
      const pdfDoc = await PDFDocument.create();
      const embeddedAsset = await embedFunc(pdfDoc);

      const usedRows = Math.ceil(quantity / logosPerRow);
      const usedHeightPts =
        usedRows * logoTotalHeight + safeMarginPts * 2 - spacingPts;
      const roundedHeightPts =
        Math.ceil(usedHeightPts / POINTS_PER_INCH) * POINTS_PER_INCH;

      const page = pdfDoc.addPage([sheetWidthPts, roundedHeightPts]);
      let yCursor = roundedHeightPts - safeMarginPts - logoHeightPts;
      let placed = 0;

      while (placed < quantity) {
        let xCursor = safeMarginPts;
        for (let c = 0; c < logosPerRow && placed < quantity; c++) {
          drawLogo(page, embeddedAsset, xCursor, yCursor);
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
      const embeddedAsset = await embedFunc(sheetDoc);

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
          drawLogo(page, embeddedAsset, xCursor, yCursor);
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
