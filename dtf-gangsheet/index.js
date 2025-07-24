import express from "express";
import multer from "multer";
import { PDFDocument, degrees } from "pdf-lib";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

// constants
const SHEET_WIDTH_INCH = 22;
const MAX_SHEET_HEIGHT_INCH = 200;
const SAFE_MARGIN_INCH = 0.125;
const SPACING_INCH = 0.5;
const POINTS_PER_INCH = 72;

// Serve the test.html page
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "test.html"));
});

// MERGE endpoint for generating gang sheets
app.post("/merge", upload.single("file"), async (req, res) => {
  try {
    const qty = parseInt(req.body.qty || "10");
    const rotateChoice = req.body.rotate || "no";
    const rotateAngle = rotateChoice === "yes" ? 90 : 0;

    const uploadedPDF = req.file.buffer;

    const gangDoc = await PDFDocument.create();
    const sheetWidthPts = SHEET_WIDTH_INCH * POINTS_PER_INCH;
    const maxSheetHeightPts = MAX_SHEET_HEIGHT_INCH * POINTS_PER_INCH;

    const srcDoc = await PDFDocument.load(uploadedPDF);
    const [embeddedPage] = await gangDoc.embedPdf(await srcDoc.save());

    let originalWidth = embeddedPage.width;
    let originalHeight = embeddedPage.height;

    // Handle rotated dimensions
    const isRotated = rotateAngle === 90 || rotateAngle === 270;
    const logoWidthPts = isRotated ? originalHeight : originalWidth;
    const logoHeightPts = isRotated ? originalWidth : originalHeight;

    const marginPts = SAFE_MARGIN_INCH * POINTS_PER_INCH;
    const spacingPts = SPACING_INCH * POINTS_PER_INCH;

    const usableWidth = sheetWidthPts - marginPts * 2;

    // Fit per row (width always fixed at 22 inches)
    const perRow = Math.floor((usableWidth + spacingPts) / (logoWidthPts + spacingPts));

    // Calculate how many rows are needed
    const totalRows = Math.ceil(qty / perRow);

    // Total height required
    const neededHeight = totalRows * logoHeightPts + (totalRows - 1) * spacingPts + marginPts * 2;

    // Cap height to MAX_SHEET_HEIGHT_INCH but also round up to nearest inch
    const finalHeightInches = Math.min(
      Math.ceil(neededHeight / POINTS_PER_INCH),
      MAX_SHEET_HEIGHT_INCH
    );

    const sheetHeightPts = finalHeightInches * POINTS_PER_INCH;

    // Create the gang sheet page
    const gangPage = gangDoc.addPage([sheetWidthPts, sheetHeightPts]);

    let placed = 0;

    const perCol = Math.floor(
      (sheetHeightPts - marginPts * 2 + spacingPts) / (logoHeightPts + spacingPts)
    );

    for (let row = 0; row < perCol && placed < qty; row++) {
      for (let col = 0; col < perRow && placed < qty; col++) {
        const baseX = marginPts + col * (logoWidthPts + spacingPts);
        const baseY = sheetHeightPts - marginPts - (row + 1) * logoHeightPts - row * spacingPts;

        if (rotateAngle === 90) {
          gangPage.drawPage(embeddedPage, {
            x: baseX + logoWidthPts, // shift right by width
            y: baseY,
            width: originalWidth,
            height: originalHeight,
            rotate: degrees(90)
          });
        } else {
          gangPage.drawPage(embeddedPage, {
            x: baseX,
            y: baseY,
            width: originalWidth,
            height: originalHeight
          });
        }

        placed++;
      }
    }

    console.log(`✅ Placed ${placed} logos. Sheet size: 22x${finalHeightInches} inches`);

    const finalPDF = await gangDoc.save();

    // ✅ SAFE BINARY RESPONSE FIX
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="gangsheet_22x${finalHeightInches}.pdf"`);
    res.setHeader("Content-Length", finalPDF.length);
    res.end(Buffer.from(finalPDF)); // prevent corruption on Railway

  } catch (err) {
    console.error("❌ MERGE ERROR:", err);
    res.status(500).send("❌ Error merging PDF");
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Backend running on port ${PORT}`));
