import express from "express";
import multer from "multer";
import { PDFDocument, degrees } from "pdf-lib";
import archiver from "archiver";

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(express.static("public"));

const SHEET_WIDTH_INCH = 22;
const MAX_SHEET_HEIGHT_INCH = 200;
const SAFE_MARGIN_INCH = 0.125;
const SPACING_INCH = 0.5;
const POINTS_PER_INCH = 72;

app.get("/", (req, res) => {
  res.send("✅ Gang Sheet backend with ZIP support & debug logs is running!");
});

app.post("/merge", upload.single("file"), async (req, res) => {
  console.log("📥 /merge route hit!");

  try {
    if (!req.file) {
      console.error("❌ No file received!");
      return res.status(400).send("No file uploaded!");
    }

    const qty = parseInt(req.query.qty || "10");
    const rotateAngle = parseInt(req.query.rotate || "0");
    console.log(`➡️ Requested quantity: ${qty}, rotate: ${rotateAngle}`);

    const uploadedPDF = req.file.buffer;
    console.log(`📄 Uploaded PDF size: ${uploadedPDF.length} bytes`);

    // Load the uploaded PDF
    const srcDoc = await PDFDocument.load(uploadedPDF);
    const tempDoc = await PDFDocument.create();
    const [embeddedPage] = await tempDoc.embedPdf(await srcDoc.save());
    console.log("✅ Successfully embedded PDF page");

    let originalWidth = embeddedPage.width;
    let originalHeight = embeddedPage.height;

    const isRotated = rotateAngle === 90 || rotateAngle === 270;
    const logoWidthPts = isRotated ? originalHeight : originalWidth;
    const logoHeightPts = isRotated ? originalWidth : originalHeight;

    const marginPts = SAFE_MARGIN_INCH * POINTS_PER_INCH;
    const spacingPts = SPACING_INCH * POINTS_PER_INCH;

    const sheetWidthPts = SHEET_WIDTH_INCH * POINTS_PER_INCH;
    const maxSheetHeightPts = MAX_SHEET_HEIGHT_INCH * POINTS_PER_INCH;
    const usableWidth = sheetWidthPts - marginPts * 2;
    const perRow = Math.floor((usableWidth + spacingPts) / (logoWidthPts + spacingPts));

    console.log(`🧮 Can fit ${perRow} per row`);

    let remaining = qty;
    let allSheets = [];
    let sheetIndex = 1;

    while (remaining > 0) {
      const rowsNeeded = Math.ceil(remaining / perRow);
      const requiredHeightPts =
        marginPts * 2 + rowsNeeded * logoHeightPts + (rowsNeeded - 1) * spacingPts;

      const sheetHeightPts = Math.min(requiredHeightPts, maxSheetHeightPts);

      const rowsPerSheet = Math.floor(
        (sheetHeightPts - marginPts * 2 + spacingPts) / (logoHeightPts + spacingPts)
      );
      const maxPerSheet = rowsPerSheet * perRow;

      const actualHeightInches = Math.ceil(sheetHeightPts / POINTS_PER_INCH);

      console.log(
        `📄 Creating sheet #${sheetIndex}: ${SHEET_WIDTH_INCH}x${actualHeightInches} inches, can hold ${maxPerSheet} logos`
      );

      const gangDoc = await PDFDocument.create();
      const gangPage = gangDoc.addPage([sheetWidthPts, sheetHeightPts]);

      let placedOnThisSheet = 0;

      for (let row = 0; row < rowsPerSheet && remaining > 0; row++) {
        for (let col = 0; col < perRow && remaining > 0; col++) {
          const baseX = marginPts + col * (logoWidthPts + spacingPts);
          const baseY =
            sheetHeightPts - marginPts - (row + 1) * logoHeightPts - row * spacingPts;

          if (rotateAngle === 90) {
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

          remaining--;
          placedOnThisSheet++;
        }
      }

      console.log(`✅ Placed ${placedOnThisSheet} logos on sheet #${sheetIndex}`);

      const finalPDF = await gangDoc.save();
      allSheets.push({
        filename: `gangsheet_${SHEET_WIDTH_INCH}x${actualHeightInches}.pdf`,
        buffer: finalPDF
      });

      sheetIndex++;
    }

    console.log(`✅ Total sheets generated: ${allSheets.length}`);

    // ✅ If more than 1 sheet, ZIP them
    if (allSheets.length > 1) {
      console.log("📦 Creating ZIP file with multiple sheets...");
      res.setHeader("Content-Type", "application/zip");
      res.setHeader(
        "Content-Disposition",
        "attachment; filename=gangsheets_bundle.zip"
      );

      const archive = archiver("zip", { zlib: { level: 9 } });
      archive.pipe(res);

      for (const sheet of allSheets) {
        archive.append(sheet.buffer, { name: sheet.filename });
        console.log(`📄 Added ${sheet.filename} to ZIP`);
      }

      archive.finalize();
    } else {
      console.log(`⬇️ Sending single PDF: ${allSheets[0].filename}`);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename=${allSheets[0].filename}`
      );
      res.end(Buffer.from(allSheets[0].buffer));
    }
  } catch (err) {
    console.error("❌ MERGE ERROR:", err);
    res.status(500).send("❌ Failed to generate gang sheet.");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Backend running on port ${PORT}`));
