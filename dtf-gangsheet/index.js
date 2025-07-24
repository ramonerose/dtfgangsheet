import express from "express";
import multer from "multer";
import { PDFDocument, degrees } from "pdf-lib";

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

// Constants
const SHEET_WIDTH_INCH = 22;
const MAX_SHEET_HEIGHT_INCH = 200; // max allowed height
const SAFE_MARGIN_INCH = 0.125;
const SPACING_INCH = 0.5;
const POINTS_PER_INCH = 72;

// Serve HTML form
app.use(express.static("public"));

app.get("/", (req, res) => {
  res.sendFile("test.html", { root: "." });
});

app.post("/merge", upload.single("file"), async (req, res) => {
  try {
    const qty = parseInt(req.body.qty || "1");
    const rotate = req.body.rotate === "yes"; // rotate 90°?

    const uploadedPDF = req.file.buffer;

    // Load PDF once
    const srcDoc = await PDFDocument.load(uploadedPDF);
    const srcPage = srcDoc.getPages()[0];
    const srcWidth = srcPage.getWidth();
    const srcHeight = srcPage.getHeight();

    // Adjust if rotated
    const logoWidthInch = rotate ? srcHeight / POINTS_PER_INCH : srcWidth / POINTS_PER_INCH;
    const logoHeightInch = rotate ? srcWidth / POINTS_PER_INCH : srcHeight / POINTS_PER_INCH;

    // Calculate usable area
    const usableWidth = SHEET_WIDTH_INCH - SAFE_MARGIN_INCH * 2;
    const usableHeight = MAX_SHEET_HEIGHT_INCH - SAFE_MARGIN_INCH * 2;

    // Fit logos per row/column for a full 22x200 sheet
    const perRow = Math.floor((usableWidth + SPACING_INCH) / (logoWidthInch + SPACING_INCH));
    const perColMax = Math.floor((usableHeight + SPACING_INCH) / (logoHeightInch + SPACING_INCH));

    const perFullSheet = perRow * perColMax; // total logos that fit in 22x200

    // Determine how many full 22x200 sheets we need
    const fullSheetsNeeded = Math.floor(qty / perFullSheet);
    const remainder = qty % perFullSheet;

    console.log(`Per row: ${perRow}, per column: ${perColMax}, per full sheet: ${perFullSheet}`);
    console.log(`Full 22x200 sheets: ${fullSheetsNeeded}, leftover logos: ${remainder}`);

    // Create an array to hold all resulting sheets
    const allSheetPDFs = [];

    // Helper function to create a sheet of any height
    const createSheet = async (logosToPlace, sheetHeightInch) => {
      const gangDoc = await PDFDocument.create();
      const sheetWidthPts = SHEET_WIDTH_INCH * POINTS_PER_INCH;
      const sheetHeightPts = sheetHeightInch * POINTS_PER_INCH;
      const gangPage = gangDoc.addPage([sheetWidthPts, sheetHeightPts]);
      const [embeddedPage] = await gangDoc.embedPdf(await srcDoc.save());

      const marginPts = SAFE_MARGIN_INCH * POINTS_PER_INCH;
      const spacingPts = SPACING_INCH * POINTS_PER_INCH;
      const logoWidthPts = logoWidthInch * POINTS_PER_INCH;
      const logoHeightPts = logoHeightInch * POINTS_PER_INCH;

      let placed = 0;
      const maxCols = Math.floor((sheetWidthPts - marginPts * 2 + spacingPts) / (logoWidthPts + spacingPts));
      const maxRows = Math.floor((sheetHeightPts - marginPts * 2 + spacingPts) / (logoHeightPts + spacingPts));

      for (let row = 0; row < maxRows && placed < logosToPlace; row++) {
        for (let col = 0; col < maxCols && placed < logosToPlace; col++) {
          const baseX = marginPts + col * (logoWidthPts + spacingPts);
          const baseY = sheetHeightPts - marginPts - (row + 1) * logoHeightPts - row * spacingPts;

          gangPage.drawPage(embeddedPage, {
            x: rotate ? baseX + logoWidthPts : baseX,
            y: baseY,
            width: srcWidth,
            height: srcHeight,
            rotate: rotate ? degrees(90) : degrees(0),
          });

          placed++;
        }
      }

      console.log(`✅ Created a sheet ${SHEET_WIDTH_INCH}x${sheetHeightInch} with ${placed} logos`);
      return await gangDoc.save();
    };

    // 1️⃣ Fill all full 22x200 sheets
    for (let i = 0; i < fullSheetsNeeded; i++) {
      const sheetPDF = await createSheet(perFullSheet, MAX_SHEET_HEIGHT_INCH);
      allSheetPDFs.push({
        buffer: sheetPDF,
        height: MAX_SHEET_HEIGHT_INCH,
      });
    }

    // 2️⃣ Handle leftover logos
    if (remainder > 0) {
      // Calculate required rows for remainder
      const rowsNeeded = Math.ceil(remainder / perRow);
      const requiredHeightInch = rowsNeeded * (logoHeightInch + SPACING_INCH) + SAFE_MARGIN_INCH * 2;

      // Round UP to the next inch, but never exceed 200
      const finalHeightInch = Math.min(Math.ceil(requiredHeightInch), MAX_SHEET_HEIGHT_INCH);

      const sheetPDF = await createSheet(remainder, finalHeightInch);
      allSheetPDFs.push({
        buffer: sheetPDF,
        height: finalHeightInch,
      });
    }

    // If there's only one sheet → send it directly
    if (allSheetPDFs.length === 1) {
      const { buffer, height } = allSheetPDFs[0];
      const filename = `gangsheet_22x${height}.pdf`;
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      return res.send(buffer);
    }

    // If multiple sheets, merge them
    const mergedDoc = await PDFDocument.create();
    for (const { buffer } of allSheetPDFs) {
      const tempDoc = await PDFDocument.load(buffer);
      const copiedPages = await mergedDoc.copyPages(tempDoc, tempDoc.getPageIndices());
      copiedPages.forEach((page) => mergedDoc.addPage(page));
    }

    const mergedPDF = await mergedDoc.save();
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="gangsheet_combined.pdf"`);
    res.send(mergedPDF);

  } catch (err) {
    console.error("❌ MERGE ERROR:", err);
    res.status(500).send("❌ Error generating gang sheets");
  }
});

// Start server
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
