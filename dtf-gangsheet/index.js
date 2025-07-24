app.post("/merge", upload.single("file"), async (req, res) => {
  try {
    const qty = parseInt(req.query.qty || "10");
    const rotateAngle = parseInt(req.query.rotate || "0"); // 0 or 90

    const uploadedPDF = req.file.buffer;

    const sheetWidthPts = SHEET_WIDTH_INCH * POINTS_PER_INCH;
    const maxSheetHeightPts = MAX_SHEET_HEIGHT_INCH * POINTS_PER_INCH;

    const srcDoc = await PDFDocument.load(uploadedPDF);
    const [embeddedPage] = await srcDoc.embedPages([srcDoc.getPage(0)]);

    let originalWidth = embeddedPage.width;
    let originalHeight = embeddedPage.height;

    // Handle rotated dimensions
    const isRotated = rotateAngle === 90 || rotateAngle === 270;
    const logoWidthPts = isRotated ? originalHeight : originalWidth;
    const logoHeightPts = isRotated ? originalWidth : originalHeight;

    const marginPts = SAFE_MARGIN_INCH * POINTS_PER_INCH;
    const spacingPts = SPACING_INCH * POINTS_PER_INCH;

    const usableWidth = sheetWidthPts - marginPts * 2;
    const perRow = Math.floor((usableWidth + spacingPts) / (logoWidthPts + spacingPts));

    console.log(`🧠 Can fit ${perRow} logos across per row`);

    let remaining = qty;
    let sheetResults = [];

    while (remaining > 0) {
      // How many rows needed for remaining logos
      const rowsNeeded = Math.ceil(remaining / perRow);

      // Raw height required for all rows
      const requiredHeightPts =
        marginPts * 2 + rowsNeeded * logoHeightPts + (rowsNeeded - 1) * spacingPts;

      // Cap at max height allowed
      let sheetHeightPts = Math.min(requiredHeightPts, maxSheetHeightPts);

      // ✅ Round UP to the next whole inch (never round down!)
      let roundedHeightInches = Math.ceil(sheetHeightPts / POINTS_PER_INCH);
      sheetHeightPts = roundedHeightInches * POINTS_PER_INCH;

      const rowsPerSheet = Math.floor(
        (sheetHeightPts - marginPts * 2 + spacingPts) / (logoHeightPts + spacingPts)
      );
      const maxPerSheet = rowsPerSheet * perRow;

      console.log(
        `📄 This sheet will be 22x${roundedHeightInches} inches, fits up to ${maxPerSheet} logos`
      );

      // ✅ Create a single new sheet PDF for THIS sheet only
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

      console.log(`✅ Placed ${placedOnThisSheet} logos on this sheet`);

      const finalPDF = await gangDoc.save();
      const base64 = finalPDF.toString("base64");

      // ✅ Add this sheet to the results
      sheetResults.push({
        filename: `gangsheet-22x${roundedHeightInches}.pdf`,
        base64: base64
      });
    }

    console.log(`✅ Generated ${sheetResults.length} sheet(s) for ${qty} logos`);

    // ✅ Respond with JSON instead of auto-download
    res.json({
      totalSheets: sheetResults.length,
      sheets: sheetResults
    });

  } catch (err) {
    console.error("❌ MERGE ERROR:", err);
    res.status(500).send("❌ Error merging PDF");
  }
});
