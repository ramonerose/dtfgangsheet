import express from "express";
import multer from "multer";
import { PDFDocument, degrees } from "pdf-lib";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 8080;

// Production-ready middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.static("public"));

// Enhanced multer configuration with file size limits and validation
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit per file
    files: 10 // Maximum 10 files per request
  },
  fileFilter: (req, file, cb) => {
    // Only allow PDF files
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'), false);
    }
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File too large. Maximum size is 10MB.' });
    }
    if (error.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({ error: 'Too many files. Maximum is 10 files.' });
    }
  }
  if (error.message === 'Only PDF files are allowed') {
    return res.status(400).json({ error: 'Only PDF files are allowed.' });
  }
  console.error('Server error:', error);
  res.status(500).json({ error: 'Internal server error' });
});

// Production logging function
const log = (message) => {
  if (process.env.NODE_ENV === 'development') {
    console.log(`[${new Date().toISOString()}] ${message}`);
  }
};

// Constants
const POINTS_PER_INCH = 72;
const SAFE_MARGIN_INCH = 0.125;
const SPACING_INCH = 0.5;

// ✅ Default cost table (fallback)
const DEFAULT_COST_TABLE = {
  12: 5.28,
  24: 10.56,
  36: 15.84,
  48: 21.12,
  60: 26.40,
  80: 35.20,
  100: 44.00,
  120: 49.28,
  140: 56.32,
  160: 61.60,
  180: 68.64,
  200: 75.68
};

// ✅ NEW FIXED LOGIC
function calculateCost(widthInches, heightInches, costTable = DEFAULT_COST_TABLE) {
  // Round UP to the next 12-inch increment
  const roundedHeight = Math.ceil(heightInches / 12) * 12;

  // If exact tier exists, return it
  if (costTable[roundedHeight]) {
    return costTable[roundedHeight];
  }

  // Otherwise find the NEXT available tier (round up to next in table)
  const availableTiers = Object.keys(costTable).map(Number).sort((a, b) => a - b);
  const nextTier = availableTiers.find(t => t >= roundedHeight) || Math.max(...availableTiers);

  return costTable[nextTier];
}

// ✅ SIMPLE: Process each file separately (proven working approach)
app.post("/merge-consolidated", upload.array("files", 10), async (req, res) => {
  try {
    log("/merge-consolidated route hit!");

    const files = req.files;
    const quantities = JSON.parse(req.body.quantities || "[]");
    const smartFit = true; // Smart Fit is now always enabled by default
    const gangWidth = parseInt(req.body.gangWidth, 10); // 22 or 30
    const maxLengthInches = parseInt(req.body.maxLength, 10) || 200;
    
    // Get user's custom cost tables or use defaults
    let userCostTables = {
      22: DEFAULT_COST_TABLE,
      30: {
        12: 7.18, 24: 14.36, 36: 21.54, 48: 28.72, 60: 35.90, 80: 47.87,
        100: 59.84, 120: 67.02, 140: 76.60, 160: 83.78, 180: 93.35, 200: 102.92
      }
    };
    
    if (req.body.costTables) {
      try {
        userCostTables = JSON.parse(req.body.costTables);
      } catch (error) {
        log("Invalid cost tables provided, using default");
      }
    }

    if (!files || files.length === 0) throw new Error("No files uploaded");
    if (files.length !== quantities.length) throw new Error("File count doesn't match quantity count");

    log(`Processing ${files.length} files with consolidation`);
    log(`Selected gang width: ${gangWidth} inches`);
    log(`Max sheet length: ${maxLengthInches} inches`);

    // ✅ TRUE CONSOLIDATION: Collect all logos and pack them optimally
    log("Starting TRUE consolidation - collecting all logos...");
    
    // Step 1: Collect all logo data and determine optimal orientations
    const logoData = [];
    let totalLogosNeeded = 0;
    
    for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
      const uploadedFile = files[fileIndex];
      const quantity = quantities[fileIndex];
      
      log(`Analyzing file ${fileIndex + 1}: ${uploadedFile.originalname} - ${quantity} logos needed`);
      
      const uploadedPdf = await PDFDocument.load(uploadedFile.buffer);
      const uploadedPage = uploadedPdf.getPages()[0];
      let { width: logoWidth, height: logoHeight } = uploadedPage.getSize();
      
      log(`Original logo dimensions: ${logoWidth} x ${logoHeight} points (${(logoWidth/72).toFixed(2)} x ${(logoHeight/72).toFixed(2)} inches)`);

      // Determine optimal orientation for this logo
      const horizontalLayout = calculateLayout(logoWidth, logoHeight, false, gangWidth, maxLengthInches);
      const verticalLayout = calculateLayout(logoHeight, logoWidth, true, gangWidth, maxLengthInches);
      
      let bestLayout;
      let isRotated;
      if (verticalLayout.logosPerSheet > horizontalLayout.logosPerSheet) {
        bestLayout = { ...verticalLayout, orientation: 'vertical' };
        isRotated = true;
        log(`Smart Fit: Vertical wins for ${uploadedFile.originalname} (${verticalLayout.logosPerSheet} vs ${horizontalLayout.logosPerSheet} logos)`);
      } else {
        bestLayout = { ...horizontalLayout, orientation: 'horizontal' };
        isRotated = false;
        log(`Smart Fit: Horizontal wins for ${uploadedFile.originalname} (${horizontalLayout.logosPerSheet} vs ${verticalLayout.logosPerSheet} logos)`);
      }
      
      // Store logo data for consolidation
      const finalLogoWidth = isRotated ? logoHeight : logoWidth;
      const finalLogoHeight = isRotated ? logoWidth : logoHeight;
      
      log(`Final logo dimensions after rotation: ${finalLogoWidth} x ${finalLogoHeight} points (${(finalLogoWidth/72).toFixed(2)} x ${(finalLogoHeight/72).toFixed(2)} inches)`);
      
      logoData.push({
        fileIndex,
        originalName: uploadedFile.originalname,
        buffer: uploadedFile.buffer,
        quantity,
        logoWidth: finalLogoWidth,
        logoHeight: finalLogoHeight,
        isRotated,
        layout: bestLayout
      });
      
      totalLogosNeeded += quantity;
    }
    
    log(`Total logos to consolidate: ${totalLogosNeeded}`);
    
    function calculateLayout(width, height, isRotated, gangWidth, maxLength) {
      const safeMarginPts = SAFE_MARGIN_INCH * POINTS_PER_INCH;
      const spacingPts = SPACING_INCH * POINTS_PER_INCH;
      const sheetWidthPts = gangWidth * POINTS_PER_INCH;
      const maxHeightPts = maxLength * POINTS_PER_INCH;

      const logoTotalWidth = width + spacingPts;
      const logoTotalHeight = height + spacingPts;

      const logosPerRow = Math.floor(
        (sheetWidthPts - safeMarginPts * 2 + spacingPts) / logoTotalWidth
      );
      if (logosPerRow < 1) return { logosPerRow: 0, rowsPerSheet: 0, logosPerSheet: 0 };
      
      const rowsPerSheet = Math.floor(
        (maxHeightPts - safeMarginPts * 2 + spacingPts) / logoTotalHeight
      );
      const logosPerSheet = logosPerRow * rowsPerSheet;
      
      return { logosPerRow, rowsPerSheet, logosPerSheet, logoTotalWidth, logoTotalHeight };
    }

    // Step 2: Create a flat list of all logos to pack, grouped by file
    const allLogos = [];
    logoData.forEach((logo, fileIndex) => {
      for (let i = 0; i < logo.quantity; i++) {
        allLogos.push({
          ...logo,
          logoIndex: i,
          fileIndex: fileIndex
        });
      }
    });
    
    // Sort logos by file index to group them together
    allLogos.sort((a, b) => a.fileIndex - b.fileIndex);
    
    log(`Created flat list of ${allLogos.length} logos to pack, grouped by file`);
    
    // Step 3: Pack logos into sheets using a simple greedy approach
    const allSheetData = [];
    const safeMarginPts = SAFE_MARGIN_INCH * POINTS_PER_INCH;
    const spacingPts = SPACING_INCH * POINTS_PER_INCH;
    const sheetWidthPts = gangWidth * POINTS_PER_INCH;
    
    let remainingLogos = [...allLogos];
    let sheetIndex = 0;
    
    while (remainingLogos.length > 0) {
      sheetIndex++;
      log(`Creating sheet ${sheetIndex} with ${remainingLogos.length} logos remaining`);
      
      // First pass: calculate exactly how many logos fit and the height needed
      let tempYCursor = maxLengthInches * POINTS_PER_INCH - safeMarginPts;
      let tempLogosOnThisSheet = 0;
      const logosToPlace = [];
      let tempCurrentFileIndex = -1;
      let tempCurrentRowLogos = 0;
      
      for (let i = 0; i < remainingLogos.length; i++) {
        const logo = remainingLogos[i];
        const logoTotalWidth = logo.logoWidth + spacingPts;
        const logoTotalHeight = logo.logoHeight + spacingPts;
        
        // Check if we're switching to a new file
        if (logo.fileIndex !== tempCurrentFileIndex) {
          // New file, force a new row
          tempCurrentFileIndex = logo.fileIndex;
          tempCurrentRowLogos = 0;
          
          // Check if we have space for a new row
          if (tempYCursor - logoTotalHeight < safeMarginPts) {
            // No more space on this sheet
            break;
          }
          tempYCursor -= logoTotalHeight;
        } else {
          // Same file, check if we need a new row
          const logosInCurrentRow = Math.floor((sheetWidthPts - safeMarginPts * 2 + spacingPts) / logoTotalWidth);
          
          if (tempCurrentRowLogos >= logosInCurrentRow) {
            // Need a new row for the same file
            tempCurrentRowLogos = 0;
            
            // Check if we have space for a new row
            if (tempYCursor - logoTotalHeight < safeMarginPts) {
              // No more space on this sheet
              break;
            }
            tempYCursor -= logoTotalHeight;
          }
        }
        
        tempCurrentRowLogos++;
        tempLogosOnThisSheet++;
        logosToPlace.push(i);
      }
      
      // Calculate the exact height needed
      const actualHeightPts = maxLengthInches * POINTS_PER_INCH - tempYCursor + safeMarginPts;
      const finalHeightInch = Math.ceil(actualHeightPts / POINTS_PER_INCH);
      
      log(`Sheet ${sheetIndex}: Will place ${tempLogosOnThisSheet} logos, calculated height: ${finalHeightInch} inches`);
      
      // Create the page at the exact size needed
      const sheetDoc = await PDFDocument.create();
      const page = sheetDoc.addPage([sheetWidthPts, finalHeightInch * POINTS_PER_INCH]);
      
      let yCursor = finalHeightInch * POINTS_PER_INCH - safeMarginPts;
      let logosOnThisSheet = 0;
      let currentFileIndex = -1;
      let currentRowLogos = 0;
      
      // Second pass: place the logos using the same logic
      for (let i = 0; i < logosToPlace.length; i++) {
        const logoIndex = logosToPlace[i];
        const logo = remainingLogos[logoIndex];
        const logoTotalWidth = logo.logoWidth + spacingPts;
        const logoTotalHeight = logo.logoHeight + spacingPts;
        
        // Check if we're switching to a new file
        if (logo.fileIndex !== currentFileIndex) {
          // New file, force a new row
          currentFileIndex = logo.fileIndex;
          currentRowLogos = 0;
          yCursor -= logoTotalHeight;
        } else {
          // Same file, check if we need a new row
          const logosInCurrentRow = Math.floor((sheetWidthPts - safeMarginPts * 2 + spacingPts) / logoTotalWidth);
          
          if (currentRowLogos >= logosInCurrentRow) {
            // Need a new row for the same file
            currentRowLogos = 0;
            yCursor -= logoTotalHeight;
          }
        }
        
        // Calculate x position for this logo
        const xCursor = safeMarginPts + (currentRowLogos * logoTotalWidth);
        log(`Logo ${logoIndex}: currentRowLogos=${currentRowLogos}, logoTotalWidth=${logoTotalWidth}, xCursor=${xCursor}, sheetWidthPts=${sheetWidthPts}`);
        
        // Embed and draw the logo
        const [embeddedPage] = await sheetDoc.embedPdf(logo.buffer);
        
        if (logo.isRotated) {
          // For rotated logos, adjust x position to account for rotation
          // When rotated 90°, the logo extends to the left of the origin point
          // We need to add the rotated logo's width (which is the original logo's height)
          page.drawPage(embeddedPage, {
            x: xCursor + logo.logoWidth, // Add the rotated logo's width (original height)
            y: yCursor,
            rotate: degrees(90)
          });
        } else {
          page.drawPage(embeddedPage, { x: xCursor, y: yCursor });
        }
        
        log(`Placed logo ${logoIndex} at position (${xCursor}, ${yCursor}) on sheet ${sheetIndex}`);
        
        currentRowLogos++;
        logosOnThisSheet++;
      }
      
      // Remove the logos we just placed
      for (let i = logosToPlace.length - 1; i >= 0; i--) {
        remainingLogos.splice(logosToPlace[i], 1);
      }
      
      // Calculate cost based on the final height
      const cost = calculateCost(gangWidth, finalHeightInch, userCostTables[gangWidth]);
      
      // Create a descriptive filename for consolidated sheets
      const today = new Date();
      const month = String(today.getMonth() + 1).padStart(2, '0');
      const day = String(today.getDate()).padStart(2, '0');
      const year = String(today.getFullYear()).slice(-2);
      const dateString = `${month}-${day}-${year}`;
      const filename = `${gangWidth}x${finalHeightInch}_gangsheet_${dateString}.pdf`;
      
      const pdfBytes = await sheetDoc.save();
      allSheetData.push({
        filename,
        buffer: Buffer.from(pdfBytes),
        width: gangWidth,
        height: finalHeightInch,
        cost
      });
      
      log(`Completed consolidated sheet ${sheetIndex}: ${gangWidth}x${finalHeightInch} - $${cost} (${logosOnThisSheet} logos)`);
    }

    const totalCost = allSheetData.reduce((sum, s) => sum + s.cost, 0);
    log(`Total: ${allSheetData.length} sheets, $${totalCost}`);

    res.json({
      sheets: allSheetData.map(s => ({
        filename: s.filename,
        width: s.width,
        height: s.height,
        cost: s.cost,
        pdfBase64: s.buffer.toString("base64")
      })),
      totalCost
    });

  } catch (err) {
    console.error("CONSOLIDATED MERGE ERROR:", err);
    res.status(500).send(`Server error: ${err.message}`);
  }
});

// ✅ Keep original single-file endpoint for backward compatibility
app.post("/merge", upload.single("file"), async (req, res) => {
  try {
    log("/merge route hit!");

    const quantity = parseInt(req.body.quantity, 10);
    const rotate = req.body.rotate === "true";
    const gangWidth = parseInt(req.body.gangWidth, 10); // 22 or 30
    const maxLengthInches = parseInt(req.body.maxLength, 10) || 200;

    const uploadedFile = req.file;
    if (!uploadedFile) throw new Error("No file uploaded");
    if (!quantity || quantity <= 0) throw new Error("Invalid quantity");

    log(`Requested quantity: ${quantity}, rotate: ${rotate}`);
    log(`Selected gang width: ${gangWidth} inches`);
    log(`Max sheet length: ${maxLengthInches} inches`);
    log(`Uploaded PDF size: ${uploadedFile.size} bytes`);

    const uploadedPdf = await PDFDocument.load(uploadedFile.buffer);
    const uploadedPage = uploadedPdf.getPages()[0];
    let { width: logoWidth, height: logoHeight } = uploadedPage.getSize();

    let layoutWidth = logoWidth;
    let layoutHeight = logoHeight;
    if (rotate) [layoutWidth, layoutHeight] = [logoHeight, logoWidth];

    const safeMarginPts = SAFE_MARGIN_INCH * POINTS_PER_INCH;
    const spacingPts = SPACING_INCH * POINTS_PER_INCH;

    const sheetWidthPts = gangWidth * POINTS_PER_INCH;
    const maxHeightPts = maxLengthInches * POINTS_PER_INCH;

    const logoTotalWidth = layoutWidth + spacingPts;
    const logoTotalHeight = layoutHeight + spacingPts;

    const logosPerRow = Math.floor(
      (sheetWidthPts - safeMarginPts * 2 + spacingPts) / logoTotalWidth
    );
    if (logosPerRow < 1) throw new Error("Logo too wide for sheet");
    log(`Can fit ${logosPerRow} logos per row`);

    const rowsPerSheet = Math.floor(
      (maxHeightPts - safeMarginPts * 2 + spacingPts) / logoTotalHeight
    );
    const logosPerSheet = logosPerRow * rowsPerSheet;

    log(`Each sheet max ${rowsPerSheet} rows → ${logosPerSheet} logos per sheet`);

    const totalSheetsNeeded = Math.ceil(quantity / logosPerSheet);
    log(`Total sheets needed: ${totalSheetsNeeded}`);

    const drawLogo = (page, embeddedPage, x, y) => {
      if (rotate) {
        // For rotated logos, adjust x position to account for rotation
        // When rotated 90°, the logo extends to the left of the origin point
        page.drawPage(embeddedPage, {
          x: x + logoHeight, // Add the rotated logo's width
          y: y,
          rotate: degrees(90)
        });
      } else {
        page.drawPage(embeddedPage, { x, y });
      }
    };

    let allSheetData = [];
    let remaining = quantity;

    for (let sheetIndex = 0; sheetIndex < totalSheetsNeeded; sheetIndex++) {
      const sheetDoc = await PDFDocument.create();
      const [embeddedPage] = await sheetDoc.embedPdf(uploadedFile.buffer);

      const logosOnThisSheet = Math.min(remaining, logosPerSheet);
      const usedRows = Math.ceil(logosOnThisSheet / logosPerRow);
      const usedHeightPts =
        usedRows * logoTotalHeight + safeMarginPts * 2 - spacingPts;
      const roundedHeightPts =
        Math.ceil(usedHeightPts / POINTS_PER_INCH) * POINTS_PER_INCH;

      const page = sheetDoc.addPage([sheetWidthPts, roundedHeightPts]);

      let yCursor = roundedHeightPts - safeMarginPts - layoutHeight;
      let drawn = 0;

      while (drawn < logosOnThisSheet) {
        let xCursor = safeMarginPts;
        for (let c = 0; c < logosPerRow && drawn < logosOnThisSheet; c++) {
          drawLogo(page, embeddedPage, xCursor, yCursor);
          drawn++;
          remaining--;
          xCursor += logoTotalWidth;
        }
        yCursor -= logoTotalHeight;
      }

      const pdfBytes = await sheetDoc.save();
      const finalHeightInch = Math.ceil(roundedHeightPts / POINTS_PER_INCH);

      // ✅ Always round UP to the next cost tier
      const cost = calculateCost(gangWidth, finalHeightInch);

      // Get original filename without extension
      const originalName = uploadedFile.originalname.replace(/\.[^/.]+$/, "");
      const filename = `${gangWidth}x${finalHeightInch}_${originalName}.pdf`;
      allSheetData.push({
        filename,
        buffer: Buffer.from(pdfBytes),
        width: gangWidth,
        height: finalHeightInch,
        cost
      });
    }

    const totalCost = allSheetData.reduce((sum, s) => sum + s.cost, 0);

    res.json({
      sheets: allSheetData.map(s => ({
        filename: s.filename,
        width: s.width,
        height: s.height,
        cost: s.cost,
        pdfBase64: s.buffer.toString("base64")
      })),
      totalCost
    });

  } catch (err) {
    console.error("MERGE ERROR:", err);
    res.status(500).send(`Server error: ${err.message}`);
  }
});

app.listen(port, () => {
  console.log(`Backend running on port ${port}`);
}); 