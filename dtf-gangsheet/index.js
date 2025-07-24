import express from "express";
import multer from "multer";
import { PDFDocument, degrees } from "pdf-lib";
import archiver from "archiver";

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(express.static("public"));

// Constants
const SHEET_WIDTH_INCH = 22;
const MAX_SHEET_HEIGHT_INCH = 200;
const SAFE_MARGIN_INCH = 0.125;
const SPACING_INCH = 0.5;
const POINTS_PER_INCH = 72;

app.get("/", (req, res) => {
  res.send("✅ Gang Sheet PDF backend with ZIP download support is running!");
});

app.post("/merge", upload.single("file"), async (req, res) => {
  try {
    const qty = parseInt(req.query.qty || "10");
    const rotateAngle = parseInt(req.query.rotate || "0");

    if (!req.file || !req.file.buffer) {
      console.error("❌ No file uploaded!");
      return res.status(400).send("No PDF uploaded");
    }

    const uploadedPDF = req.file.buffer;

    console.log(`📄 Loading uploaded PDF...`);
    const srcDoc = await PDFDocument.load(uploadedPDF);

    const sheetWidthPts = SHEET_WIDTH_INCH * POINTS_PER_INCH;
    const maxSheetHeightPts = MAX_SHEET_HEIGHT_INCH * POINTS_PER_INCH;

    // Extract the first page to duplicate
    const [embeddedPage] = await srcDoc.copyPages(srcDoc, [0]);

    // Calculate logo dimensions
    const logoWidth = rotateAngle === 90 ? embeddedPage.getHeight() : embeddedPage.getWidth();
    const logoHeight = rotateAngle === 90 ? embeddedPage.getWidth() : embeddedPage.getHeight();

    const marginPts = SAFE_MARGIN_INCH * POINTS_PER_INCH;
    const spacingPts = SPACING_INCH * POINTS_PER_INCH;

    const usableWidth = sheetWidthPts - marginPts * 2;
    const perRow = Math.floor((usableWidth + spacingPts) / (logoWidth + spacingPts));

    console.log(`🧠 Per row: ${perRow} logos`);

    let remaining = qty;
    const gangSheets = [];

    while (remaining > 0) {
      const rowsNeeded = Math.ceil(remaining / perRow);
      const requiredHeightPts = marginPts * 2 + rowsNeeded * logoHeight + (rowsNeeded - 1) * spacingPts;
      const sheetHeightPts = Math.min(requiredHeightPts, maxSheetHeightPts);

      const rowsPerSheet = Math.floor(
        (sheetHeightPts - marginPts * 2 + spacingPts) / (logoHeight + spacingPts)
      );
      const maxPerSheet = rowsPerSheet * perRow;

      console.log(`📄 New sheet can fit ${rowsPerSheet} rows = ${maxPerSheet} logos`);

      const doc = await PDFDocument.create();
      const page = doc.addPage([sheetWidthPts, sheetHeightPts]);

      let placedOnThisSheet = 0;

      for (let row = 0; row < rowsPerSheet && remaining > 0; row++) {
        for (let col = 0; col < perRow && remaining > 0; col++) {
          const x = marginPts + col * (logoWidth + spacingPts);
          const y = sheetHeightPts - marginPts - (row + 1) * logoHeight - row * spacingPts;

          page.drawPage(embeddedPage, {
            x: rotateAngle === 90 ? x + logoWidth : x,
            y,
            width: embeddedPage.getWidth(),
            height: embeddedPage.getHeight(),
            rotate: rotateAngle === 90 ? degrees(90) : undefined
          });

          remaining--;
          placedOnThisSheet++;
        }
      }

      const sheetInches = Math.ceil(sheetHeightPts / POINTS_PER_INCH);
      const sheetBuffer = await doc.save();

      gangSheets.push({
        name: `gangsheet_22x${sheetInches}.pdf`,
        data: sheetBuffer
      });

      console.log(`✅ Sheet created: gangsheet_22x${sheetInches}.pdf with ${placedOnThisSheet} logos`);
    }

    // ✅ Single sheet → return PDF directly
    if (gangSheets.length === 1) {
      console.log("✅ Only one sheet, sending as direct PDF...");
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename=${gangSheets[0].name}`);
      return res.end(Buffer.from(gangSheets[0].data));
    }

    // ✅ Multiple sheets → create ZIP
    console.log(`📦 Creating ZIP with ${gangSheets.length} sheets...`);
    const zipArchiver = archiver("zip", { zlib: { level: 9 } });

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", "attachment; filename=gangsheets.zip");

    zipArchiver.on("error", (err) => {
      console.error("❌ ZIP ERROR:", err);
      res.status(500).send("Failed to create ZIP");
    });

    zipArchiver.pipe(res);

    gangSheets.forEach((sheet) => {
      zipArchiver.append(Buffer.from(sheet.data), { name: sheet.name });
    });

    await zipArchiver.finalize();
    console.log("✅ ZIP finalized and sent!");

  } catch (err) {
    console.error("❌ MERGE ERROR:", err);
    res.status(500).send(`❌ Error merging PDF: ${err.message}`);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Backend running on port ${PORT}`));
