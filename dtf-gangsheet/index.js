import express from "express";
import multer from "multer";
import { PDFDocument, degrees } from "pdf-lib";

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

const PORT = process.env.PORT || 8080;

const SHEET_WIDTH_INCH = 22;
const POINTS_PER_INCH = 72;
const SAFE_MARGIN_INCH = 0.125;
const PNG_DEFAULT_DPI = 300;

app.use(express.static("public"));

function log(msg) {
  console.log(`[DEBUG] ${msg}`);
}

app.post("/merge", upload.single("file"), async (req, res) => {
  try {
    log("/merge debug test route hit!");

    const rotate = true; // always rotate for debug
    const uploadedFile = req.file;

    if (!uploadedFile) throw new Error("No file uploaded");

    const originalName = uploadedFile.originalname.toLowerCase();
    if (!originalName.endsWith(".png")) {
      throw new Error("For debug mode, only PNG allowed!");
    }

    log(`DEBUG: Testing single rotated PNG at bottom-left`);

    const safeMarginPts = SAFE_MARGIN_INCH * POINTS_PER_INCH;
    const sheetWidthPts = SHEET_WIDTH_INCH * POINTS_PER_INCH;
    const sheetHeightPts = 22 * POINTS_PER_INCH; // just use 22" square for debug

    // Load PNG & determine size
    const tempDoc = await PDFDocument.create();
    const embeddedImage = await tempDoc.embedPng(uploadedFile.buffer);

    const pngWidthPx = embeddedImage.width;
    const pngHeightPx = embeddedImage.height;

    const widthInches = pngWidthPx / PNG_DEFAULT_DPI;
    const heightInches = pngHeightPx / PNG_DEFAULT_DPI;

    const widthPts = widthInches * POINTS_PER_INCH;
    const heightPts = heightInches * POINTS_PER_INCH;

    log(`PNG pixel size: ${pngWidthPx}x${pngHeightPx}`);
    log(`→ ${widthInches.toFixed(2)}x${heightInches.toFixed(2)} inches`);
    log(`→ ${widthPts.toFixed(2)}x${heightPts.toFixed(2)} pts`);

    // Create debug PDF
    const debugDoc = await PDFDocument.create();
    const page = debugDoc.addPage([sheetWidthPts, sheetHeightPts]);

    // For debug: always rotate
    const rotatedWidthPts = heightPts;  // swapped
    const rotatedHeightPts = widthPts;  // swapped

    // Try placing at safe margin
    const x = safeMarginPts;
    const y = safeMarginPts;

    // Draw rotated image
    page.drawImage(embeddedImage, {
      x: x,
      y: y,
      width: rotatedWidthPts,
      height: rotatedHeightPts,
      rotate: degrees(90)
    });

    const pdfBytes = await debugDoc.save();
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="debug_rotated_png.pdf"`);
    return res.send(Buffer.from(pdfBytes));
  } catch (err) {
    console.error("DEBUG MERGE ERROR:", err);
    res.status(500).send(`Server error: ${err.message}`);
  }
});

app.listen(PORT, () => {
  console.log(`DEBUG Backend running on port ${PORT}`);
});
