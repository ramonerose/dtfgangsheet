import express from "express";
import multer from "multer";
import { PDFDocument, degrees } from "pdf-lib";

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

// ✅ Serve static files like test.html from the public folder
app.use(express.static("public"));

// constants for sheet size
const SHEET_WIDTH_INCH = 22;
const SHEET_HEIGHT_INCH = 36;
const SAFE_MARGIN_INCH = 0.125;
const SPACING_INCH = 0.5;
const POINTS_PER_INCH = 72;

// Simple root route just to confirm it's running
app.get("/", (req, res) => {
  res.send("✅ Gang Sheet PDF backend with clean 90° rotation is running!");
});

// ✅ PDF-only merge route
app.post("/merge", upload.single("file"), async (req, res) => {
  try {
    const qty = parseInt(req.query.qty || "10");
    const rotateAngle = parseInt(req.query.rotate || "0"); // 0 or 90

    const uploadedPDF = req.file.buffer;

    const gangDoc = await PDFDocument.create();
    const sheetWidthPts = SHEET_WIDTH_INCH * POINTS_PER_INCH;
    const sheetHeightPts = SHEET_HEIGHT_INCH * POINTS_PER_INCH;
    const gangPage = gangDoc.addPage([sheetWidthPts, sheetHeightPts]);

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
    const usableHeight = sheetHeightPts - marginPts * 2;

    const perRow = Math.floor((usableWidth + spacingPts) / (logoWidthPts + spacingPts));
    const perCol = Math.floor((usableHeight + spacingPts) / (logoHeightPts + spacingPts));

    console.log(`🧠 Can fit ${perRow} logos across × ${perCol} down`);

    let placed = 0;

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

    console.log(`✅ Placed ${placed} logos`);

    const finalPDF = await gangDoc.save();

    // ✅ Railway-safe binary response (prevents corruption)
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "attachment; filename=gangsheet.pdf");
    res.setHeader("Content-Length", finalPDF.length);
    res.end(Buffer.from(finalPDF)); // send as raw binary

  } catch (err) {
    console.error("❌ MERGE ERROR:", err);
    res.status(500).send("❌ Error merging PDF");
  }
});

// ✅ Use Railway port or fallback to 3000
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Backend running on port ${PORT}`));
