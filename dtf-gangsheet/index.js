import express from "express";
import multer from "multer";
import { PDFDocument, degrees } from "pdf-lib";

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

const SHEET_WIDTH_INCH = 22;
const MAX_SHEET_HEIGHT_INCH = 200; // Maximum allowed height
const SAFE_MARGIN_INCH = 0.125;
const SPACING_INCH = 0.5;
const POINTS_PER_INCH = 72;

app.use(express.static("public"));

app.get("/", (req, res) => {
  res.sendFile("test.html", { root: "public" });
});

app.post("/merge", upload.single("file"), async (req, res) => {
  try {
    const qty = parseInt(req.body.quantity || "1");
    const rotate = req.body.rotate === "yes";

    const uploadedPDF = req.file.buffer;

    const srcDoc = await PDFDocument.load(uploadedPDF);
    const [embeddedPage] = await srcDoc.embedPages([srcDoc.getPage(0)]);

    let originalWidth = embeddedPage.width;
    let originalHeight = embeddedPage.height;

    const isRotated = rotate;
    const logoWidthPts = isRotated ? originalHeight : originalWidth;
    const logoHeightPts = isRotated ? originalWidth : originalHeight;

    const marginPts = SAFE_MARGIN_INCH * POINTS_PER_INCH;
    const spacingPts = SPACING_INCH * POINTS_PER_INCH;

    const sheetWidthPts = SHEET_WIDTH_INCH * POINTS_PER_INCH;
    const maxSheetHeightPts = MAX_SHEET_HEIGHT_INCH * POINTS_PER_INCH;

    const usableWidth = sheetWidthPts - marginPts * 2;
    const usableHeight = maxSheetHeightPts - marginPts * 2;

    // Calculate how many fit per row/column on a FULL 22x200 sheet
    const perRow = Math.floor((usableWidth + spacingPts) / (logoWidthPts + spacingPts));
    const perCol = Math.floor((usableHeight + spacingPts) / (logoHeightPts + spacingPts));

    const maxPerFullSheet = perRow * perCol;

    console.log(`🧠 Each FULL sheet can hold ${maxPerFullSheet} logos`);

    let remaining = qty;
    const allSheets = [];

    while (remaining > 0) {
      // If remaining > maxPerFullSheet, fill a full 22x200
      const logosThisSheet = Math.min(remaining, maxPerFullSheet);

      // Determine how many rows we need for THIS sheet
      const neededRows = Math.ceil(logosThisSheet / perRow);
      const sheetHeightNeededPts =
        neededRows * logoHeightPts + (neededRows - 1) * spacingPts + marginPts * 2;

      // Round UP to next inch for height
      const roundedHeightInches = Math.ceil(sheetHeightNeededPts / POINTS_PER_INCH);
      const finalHeightPts = roundedHeightInches * POINTS_PER_INCH;

      const gangDoc = await PDFDocument.create();
      const gangPage = gangDoc.addPage([sheetWidthPts, finalHeightPts]);

      console.log(`✅ Creating sheet ${SHEET_WIDTH_INCH}x${roundedHeightInches} inches with ${logosThisSheet} logos`);

      let placed = 0;
      for (let row = 0; row < neededRows && placed < logosThisSheet; row++) {
        for (let col = 0; col < perRow && placed < logosThisSheet; col++) {
          const baseX = marginPts + col * (logoWidthPts + spacingPts);
          const baseY = finalHeightPts - marginPts - (row + 1) * logoHeightPts - row * spacingPts;

          if (rotate) {
            gangPage.drawPage(embeddedPage, {
              x: baseX + logoWidthPts,
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

      const pdfBytes = await gangDoc.save();
      allSheets.push({ bytes: pdfBytes, height: roundedHeightInches });

      remaining -= logosThisSheet;
    }

    // For now, still merge all sheets into ONE combined PDF
    const combinedDoc = await PDFDocument.create();
    for (const sheet of allSheets) {
      const tempDoc = await PDFDocument.load(sheet.bytes);
      const [tempPage] = await combinedDoc.copyPages(tempDoc, [0]);
      combinedDoc.addPage(tempPage);
    }

    const finalPDF = await combinedDoc.save();
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="gangsheet_combined.pdf"`
    );
    res.send(finalPDF);

  } catch (err) {
    console.error("❌ MERGE ERROR:", err);
    res.status(500).send("❌ Error generating gang sheet");
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`✅ Backend running on port ${PORT}`));
