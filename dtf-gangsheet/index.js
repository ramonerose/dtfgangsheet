import express from "express";
import multer from "multer";
import { PDFDocument, degrees } from "pdf-lib";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

// ✅ Get current directory (needed for ES modules)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ✅ Serve static files like test.html directly
app.use(express.static(__dirname));

// ✅ Constants
const SHEET_WIDTH_INCH = 22;           // Always fixed width
const MAX_SHEET_HEIGHT_INCH = 200;     // Cap height at 200 inches
const SAFE_MARGIN_INCH = 0.125;        // Keep margin all around
const SPACING_INCH = 0.5;              // Space between logos
const POINTS_PER_INCH = 72;            // 1 inch = 72 PDF points

// ✅ Health check route
app.get("/", (req, res) => {
  res.send("✅ Gang Sheet PDF backend with multi-sheet support is running! Try /test.html");
});

// ✅ Main PDF merge route
app.post("/merge", upload.single("file"), async (req, res) => {
  try {
    const qty = parseInt(req.query.qty || "10");
    const rotateAngle = parseInt(req.query.rotate || "0"); // manual 0° or 90°

    const uploadedPDF = req.file.buffer;
    const srcDoc = await PDFDocument.load(uploadedPDF);

    // Take the *first page* of the uploaded file
    const [sourcePage] = await srcDoc.copyPages(srcDoc, [0]);
    const sourceWidth = sourcePage.getWidth();
    const sourceHeight = sourcePage.getHeight();

    const isRotated = rotateAngle === 90 || rotateAngle === 270;
    const logoWidthPts = isRotated ? sourceHeight : sourceWidth;
    const logoHeightPts = isRotated ? sourceWidth : sourceHeight;

    const marginPts = SAFE_MARGIN_INCH * POINTS_PER_INCH;
    const spacingPts = SPACING_INCH * POINTS_PER_INCH;

    // ✅ Convert sheet dimensions to points
    const sheetWidthPts = SHEET_WIDTH_INCH * POINTS_PER_INCH;
    const maxSheetHeightPts = MAX_SHEET_HEIGHT_INCH * POINTS_PER_INCH;

    // ✅ Calculate how many logos per row & column on *max* sheet
    const usableWidth = sheetWidthPts - marginPts * 2;
    const usableHeight = maxSheetHeightPts - marginPts * 2;
    const maxPerRow = Math.floor((usableWidth + spacingPts) / (logoWidthPts + spacingPts));
    const maxPerCol = Math.floor((usableHeight + spacingPts) / (logoHeightPts + spacingPts));

    if (maxPerRow === 0 || maxPerCol === 0) {
      return res.status(400).send("❌ Logo is too large to fit on the sheet!");
    }

    // ✅ Compute how many logos per *single* MAX sheet
    const maxPerSheet = maxPerRow * maxPerCol;
    const totalSheetsNeeded = Math.ceil(qty / maxPerSheet);

    console.log(`📏 Each MAX sheet fits ${maxPerRow} x ${maxPerCol} = ${maxPerSheet} logos`);
    console.log(`📦 You requested ${qty}, so we need ${totalSheetsNeeded} sheet(s)`);

    let remaining = qty;
    const generatedSheets = [];

    for (let sheetIndex = 0; sheetIndex < totalSheetsNeeded; sheetIndex++) {
      const gangDoc = await PDFDocument.create();

      // ✅ Dynamic sheet height: only as tall as needed for *this sheet*
      const logosThisSheet = Math.min(remaining, maxPerSheet);
      const neededRows = Math.ceil(logosThisSheet / maxPerRow);
      const neededHeightPts =
        neededRows * logoHeightPts +
        (neededRows - 1) * spacingPts +
        marginPts * 2;

      // ✅ Round UP to next inch so it doesn’t cut off
      const neededHeightInches = Math.ceil(neededHeightPts / POINTS_PER_INCH);
      const finalSheetHeightPts = neededHeightInches * POINTS_PER_INCH;

      const gangPage = gangDoc.addPage([sheetWidthPts, finalSheetHeightPts]);

      // ✅ Embed the uploaded logo page into this new gang sheet doc
      const embeddedPage = await gangDoc.embedPage(sourcePage);

      let placed = 0;
      for (let row = 0; row < neededRows && placed < logosThisSheet; row++) {
        for (let col = 0; col < maxPerRow && placed < logosThisSheet; col++) {
          const baseX = marginPts + col * (logoWidthPts + spacingPts);
          const baseY = finalSheetHeightPts - marginPts - (row + 1) * logoHeightPts - row * spacingPts;

          if (rotateAngle === 90) {
            gangPage.drawPage(embeddedPage, {
              x: baseX + logoWidthPts,
              y: baseY,
              width: sourceWidth,
              height: sourceHeight,
              rotate: degrees(90),
            });
          } else {
            gangPage.drawPage(embeddedPage, {
              x: baseX,
              y: baseY,
              width: sourceWidth,
              height: sourceHeight,
            });
          }
          placed++;
        }
      }

      console.log(`✅ Sheet ${sheetIndex + 1} placed ${placed} logos`);
      remaining -= placed;

      const pdfBytes = await gangDoc.save();

      // ✅ Save this sheet with a descriptive name
      const sheetHeightRounded = Math.ceil(finalSheetHeightPts / POINTS_PER_INCH);
      const filename = `gangsheet_${sheetIndex + 1}_22x${sheetHeightRounded}.pdf`;

      generatedSheets.push({ filename, pdfBytes });
    }

    // ✅ If only 1 sheet → return it directly
    if (generatedSheets.length === 1) {
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${generatedSheets[0].filename}"`
      );
      res.send(generatedSheets[0].pdfBytes);
    } else {
      // TODO: Phase 2 → multi-sheet links instead of 1 file
      res.status(501).send(
        `✅ ${generatedSheets.length} sheets generated but multi-download links coming in next step`
      );
    }
  } catch (err) {
    console.error("❌ MERGE ERROR:", err);
    res.status(500).send("❌ Error merging PDF");
  }
});

// ✅ Server listen
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Backend running on port ${PORT}`));
