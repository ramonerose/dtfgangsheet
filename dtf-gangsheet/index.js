import express from "express";
import multer from "multer";
import { PDFDocument, degrees, rgb } from "pdf-lib";

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

const PORT = process.env.PORT || 8080;

const SHEET_WIDTH_INCH = 22;
const POINTS_PER_INCH = 72;
const SAFE_MARGIN_INCH = 0.5; // bigger margin for debug
const PNG_DEFAULT_DPI = 300;

app.use(express.static("public"));

function log(msg) {
  console.log(`[DEBUG] ${msg}`);
}

app.post("/merge", upload.single("file"), async (req, res) => {
  try {
    log("DEBUG TEST: Rotated PNG with manual transform");

    const uploadedFile = req.file;
    if (!uploadedFile) throw new Error("No file uploaded");
    const name = uploadedFile.originalname.toLowerCase();
    if (!name.endsWith(".png")) throw new Error("Only PNG for debug!");

    // Embed the PNG to get size
    const debugDoc = await PDFDocument.create();
    const embeddedPng = await debugDoc.embedPng(uploadedFile.buffer);

    const pngWidthPx = embeddedPng.width;
    const pngHeightPx = embeddedPng.height;

    const widthInches = pngWidthPx / PNG_DEFAULT_DPI;
    const heightInches = pngHeightPx / PNG_DEFAULT_DPI;

    const widthPts = widthInches * POINTS_PER_INCH;
    const heightPts = heightInches * POINTS_PER_INCH;

    log(`PNG size: ${pngWidthPx}x${pngHeightPx}px -> ${widthPts.toFixed(2)}x${heightPts.toFixed(2)} pts`);

    // Make a 22x22 inch debug page
    const pageSize = SHEET_WIDTH_INCH * POINTS_PER_INCH;
    const page = debugDoc.addPage([pageSize, pageSize]);

    // Draw a visible guide box so we know the margin
    const safeMarginPts = SAFE_MARGIN_INCH * POINTS_PER_INCH;
    page.drawRectangle({
      x: safeMarginPts,
      y: safeMarginPts,
      width: widthPts,
      height: heightPts,
      borderColor: rgb(1, 0, 0),
      borderWidth: 2,
    });

    // NOW do a manual rotate:
    // Translate UP by image width, rotate, then draw
    const xAnchor = safeMarginPts;
    const yAnchor = safeMarginPts;

    page.drawImage(embeddedPng, {
      x: xAnchor,
      y: yAnchor,
      width: heightPts,  // swapped
      height: widthPts,
      rotate: degrees(90)
    });

    const pdfBytes = await debugDoc.save();
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'attachment; filename="debug_rotated_matrix.pdf"');
    res.send(Buffer.from(pdfBytes));
  } catch (err) {
    console.error("DEBUG ERROR:", err);
    res.status(500).send(`Debug error: ${err.message}`);
  }
});

app.listen(PORT, () => console.log("DEBUG rotation server running..."));
