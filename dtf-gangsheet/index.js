import express from "express";
import multer from "multer";
import { PDFDocument, degrees } from "pdf-lib";
import archiver from "archiver";
import stream from "stream";

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

// ✅ Serve static files like test.html from the public folder
app.use(express.static("public"));

// constants for sheet size
const SHEET_WIDTH_INCH = 22;
const MAX_SHEET_HEIGHT_INCH = 200; // max sheet height
const SAFE_MARGIN_INCH = 0.125;
const SPACING_INCH = 0.5;
const POINTS_PER_INCH = 72;

// ✅ Root route just to confirm it's running
app.get("/", (req, res) => {
  res.send("✅ Gang Sheet PDF backend with ZIP multi-sheet support is running!");
});

app.post("/merge", upload.single("file"), async (req, res) => {
  try {
    const qty = parseInt(req.query.qty || "10");
    const rotateAngle = parseInt(req.query.rotate || "0"); // 0 or 90
    const uploadedPDF = req.file.buffer;

    // ✅ Load source document ONCE so we can re-embed for each sheet
    const srcDocOriginal = await PDFDocument.load(uploadedPDF);

    // ✅ Grab logo dimensions
    const tempDoc = await PDFDocument.create();
    const [tempEmbed] = await tempDoc.embedPdf(await srcDocOriginal.save());
    const origWidth = tempEmbed.width;
    const origHeight = tempEmbed.height;
    const isRotated = rotateAngle === 90 || rotateAngle === 270;
    const logoWidthPts = isRotated ? origHeight : origWidth;
    const logoHeightPts = isRotated ? origWidth : origHeight;

    // ✅ Calculate layout
    const sheetWidthPts = SHEET_WIDTH_INCH * POINTS_PER_INCH;
    const maxSheetHeightPts = MAX_SHEET_HEIGHT_INCH * POINTS_PER_INCH;
    const marginPts = SAFE_MARGIN_INCH * POINTS_PER_INCH;
    const spacingPts = SPACING_INCH * POINTS_PER_INCH;
    const usableWidth = sheetWidthPts - marginPts * 2;
    const perRow = Math.floor((usableWidth + spacingPts) / (logoWidthPts + spacingPts));

    let remaining = qty;
    let sheetIndex = 0;

    // Store generated sheet buffers for ZIP if needed
    const generatedSheets = [];

    while (remaining > 0) {
      // ✅ How many rows needed for remaining logos
      const rowsNeeded = Math.ceil(remaining / perRow);

      // ✅ Required height for these rows
      const requiredHeightPts =
        marginPts * 2 + rowsNeeded * logoHeightPts + (rowsNeeded - 1) * spacingPts;

      // ✅ Cap height to max allowed
      const sheetHeightPts = Math.min(requiredHeightPts, maxSheetHeightPts);

      const rowsPerSheet = Math.floor(
        (sheetHeightPts - marginPts * 2 + spacingPts) / (logoHeightPts + spacingPts)
      );
      const maxPerSheet = rowsPerSheet * perRow;

      const logosOnThisSheet = Math.min(maxPerSheet, remaining);

      // ✅ ROUNDED HEIGHT (always round UP to next inch)
      const sheetHeightInches = Math.ceil(sheetHeightPts / POINTS_PER_INCH);
      const finalSheetHeightPts = sheetHeightInches * POINTS_PER_INCH;

      console.log(
        `📄 Sheet ${sheetIndex + 1}: can fit ${logosOnThisSheet} logos → ${SHEET_WIDTH_INCH}x${sheetHeightInches} inches`
      );

      // ✅ Create a fresh PDFDocument for this sheet
      const sheetDoc = await PDFDocument.create();
      const gangPage = sheetDoc.addPage([sheetWidthPts, finalSheetHeightPts]);

      // ✅ RE-EMBED LOGO for this sheet
      const [embeddedPageForThisSheet] = await sheetDoc.embedPdf(await srcDocOriginal.save());

      let placedOnThisSheet = 0;

      for (let row = 0; row < rowsPerSheet && remaining > 0; row++) {
        for (let col = 0; col < perRow && remaining > 0; col++) {
          const baseX = marginPts + col * (logoWidthPts + spacingPts);
          const baseY =
            finalSheetHeightPts - marginPts - (row + 1) * logoHeightPts - row * spacingPts;

          if (rotateAngle === 90) {
            gangPage.drawPage(embeddedPageForThisSheet, {
              x: baseX + logoWidthPts,
              y: baseY,
              width: origWidth,
              height: origHeight,
              rotate: degrees(90),
            });
          } else {
            gangPage.drawPage(embeddedPageForThisSheet, {
              x: baseX,
              y: baseY,
              width: origWidth,
              height: origHeight,
            });
          }

          remaining--;
          placedOnThisSheet++;
        }
      }

      console.log(`✅ Placed ${placedOnThisSheet} logos on sheet ${sheetIndex + 1}`);

      const sheetBuffer = await sheetDoc.save();

      // ✅ Name sheet properly for ZIP
      const sheetFilename = `gangsheet_${SHEET_WIDTH_INCH}x${sheetHeightInches}.pdf`;
      generatedSheets.push({ name: sheetFilename, buffer: sheetBuffer });

      sheetIndex++;
    }

    console.log(`✅ Total sheets created: ${generatedSheets.length}`);

    // ✅ If only ONE sheet → download normally
    if (generatedSheets.length === 1) {
      const single = generatedSheets[0];
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${single.name}"`
      );
      return res.end(Buffer.from(single.buffer));
    }

    // ✅ MULTIPLE SHEETS → create a ZIP archive
    res.setHeader("Content-Type", "application/zip");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=gangsheets_${generatedSheets.length}_files.zip`
    );

    const archive = archiver("zip", { zlib: { level: 9 } });
    const passthrough = new stream.PassThrough();

    archive.pipe(passthrough);

    generatedSheets.forEach((sheet) => {
      archive.append(sheet.buffer, { name: sheet.name });
    });

    archive.finalize();

    passthrough.pipe(res);

  } catch (err) {
    console.error("❌ MERGE ERROR:", err);
    res.status(500).send("❌ Error merging PDF into ZIP");
  }
});

// ✅ Use Railway port or fallback to 3000
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Backend running on port ${PORT}`));
