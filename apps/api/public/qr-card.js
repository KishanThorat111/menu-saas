/**
 * KODSPOT — Premium QR Card Generator v4.0
 * 600 DPI A6 · Dark walnut + gold Victorian luxury
 * Used by both admin.js and superadmin.js
 */
var KodSpotQR = (function () {
  'use strict';

  /* ══════════════════════════════════════════════════════════════════════
   *  CONSTANTS
   * ══════════════════════════════════════════════════════════════════════ */
  var W = 2480;
  var H = 3508;

  /* ── Premium QR Card Themes ───────────────────────────────────────── */
  var THEMES = {
    walnut: {
      id: 'walnut', label: 'Royal Walnut',
      bgDark: '#2A1508', bgMid: '#3B2314', bgLight: '#4D301A',
      gold: '#C5A55A', goldHi: '#E0CC88', goldLo: '#96782E',
      cream: '#F5E6C8', creamSoft: '#D9C6A0',
      white: '#FFFFFF', kBadge: '#D4900A', footerTxt: '#8B7355'
    },
    noir: {
      id: 'noir', label: 'Obsidian Noir',
      bgDark: '#0D0B10', bgMid: '#1A161E', bgLight: '#28222E',
      gold: '#C49688', goldHi: '#DDBCB0', goldLo: '#8A6458',
      cream: '#F0EBE6', creamSoft: '#C4BAB2',
      white: '#FFFFFF', kBadge: '#C49688', footerTxt: '#706460'
    },
    sapphire: {
      id: 'sapphire', label: 'Sapphire Regal',
      bgDark: '#080E1C', bgMid: '#101E34', bgLight: '#1C2E48',
      gold: '#A8B8C8', goldHi: '#CCD8E2', goldLo: '#6E808E',
      cream: '#ECF0F4', creamSoft: '#A8B4C0',
      white: '#FFFFFF', kBadge: '#3A6EA8', footerTxt: '#5A6A7A'
    },
    emerald: {
      id: 'emerald', label: 'Emerald Imperial',
      bgDark: '#0C1A10', bgMid: '#1A3020', bgLight: '#284236',
      gold: '#D4AF37', goldHi: '#E8D48B', goldLo: '#A08020',
      cream: '#F0EDE0', creamSoft: '#C4C0AC',
      white: '#FFFFFF', kBadge: '#2C8E4E', footerTxt: '#5A6858'
    },
    bordeaux: {
      id: 'bordeaux', label: 'Bordeaux Velvet',
      bgDark: '#14060C', bgMid: '#2C1220', bgLight: '#401C2C',
      gold: '#C8B478', goldHi: '#E0D4A8', goldLo: '#967836',
      cream: '#F5EDDE', creamSoft: '#D4C4A8',
      white: '#FFFFFF', kBadge: '#A03050', footerTxt: '#7A6058'
    },
    marble: {
      id: 'marble', label: 'Carrara Marble',
      bgDark: '#D8CFC2', bgMid: '#E4DDD2', bgLight: '#EDE8E0',
      gold: '#A68A4C', goldHi: '#C4AA6E', goldLo: '#7A6232',
      cream: '#1E1610', creamSoft: '#3E3228',
      white: '#FFFFFF', kBadge: '#A68A4C', footerTxt: '#7A6E5E',
      isLight: true, pillTxt: '#FFFFFF',
      shadowGold: 'rgba(120,100,50,0.35)', shadowGlow: 'rgba(90,70,30,0.25)'
    },
    navy: {
      id: 'navy', label: 'Royal Navy',
      bgDark: '#0A1628', bgMid: '#142440', bgLight: '#1E3458',
      gold: '#C5A55A', goldHi: '#E0CC88', goldLo: '#96782E',
      cream: '#F0E8D8', creamSoft: '#B8AE9C',
      white: '#FFFFFF', kBadge: '#1E5090', footerTxt: '#6878A0'
    },
    crimson: {
      id: 'crimson', label: 'Crimson Imperial',
      bgDark: '#1A0808', bgMid: '#301010', bgLight: '#4A1818',
      gold: '#D4A850', goldHi: '#E8CA80', goldLo: '#A07828',
      cream: '#F5E8D6', creamSoft: '#C8BAA4',
      white: '#FFFFFF', kBadge: '#A03030', footerTxt: '#8A6050'
    },
    champagne: {
      id: 'champagne', label: 'Champagne Pearl',
      bgDark: '#1E1A16', bgMid: '#2E2820', bgLight: '#3E362C',
      gold: '#D4C4A0', goldHi: '#E8DCC0', goldLo: '#A09070',
      cream: '#F5F0E6', creamSoft: '#C8C0B0',
      white: '#FFFFFF', kBadge: '#C4A870', footerTxt: '#8A8070'
    },
    teal: {
      id: 'teal', label: 'Midnight Teal',
      bgDark: '#081A1C', bgMid: '#0E2E30', bgLight: '#184042',
      gold: '#C5A55A', goldHi: '#E0CC88', goldLo: '#96782E',
      cream: '#E8F0EC', creamSoft: '#A8B8B0',
      white: '#FFFFFF', kBadge: '#1A7A6A', footerTxt: '#5A8A80'
    }
  };

  var C = THEMES.walnut; // default, overridden per-render

  /* ══════════════════════════════════════════════════════════════════════
   *  UTILITIES
   * ══════════════════════════════════════════════════════════════════════ */
  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function loadImg(src) {
    return new Promise(function (ok) {
      var i = new Image();
      i.onload = function () { ok(i); };
      i.onerror = function () { ok(null); };
      i.src = src;
    });
  }

  function loadQrImage(svg) {
    return loadImg('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg));
  }

  function truncName(ctx, name, maxW) {
    var d = name;
    while (ctx.measureText(d).width > maxW && d.length > 10) d = d.slice(0, -1);
    if (d !== name) d += '\u2026';
    return d;
  }

  function safeName(n) {
    return (n || 'menu').replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '_').substring(0, 40);
  }

  function gGrad(ctx, x1, y1, x2, y2) {
    var g = ctx.createLinearGradient(x1, y1, x2, y2);
    g.addColorStop(0, C.goldLo);
    g.addColorStop(0.25, C.goldHi);
    g.addColorStop(0.5, C.gold);
    g.addColorStop(0.75, C.goldHi);
    g.addColorStop(1, C.goldLo);
    return g;
  }

  /* ══════════════════════════════════════════════════════════════════════
   *  BACKGROUND — dark walnut with subtle leather texture
   * ══════════════════════════════════════════════════════════════════════ */
  function drawBg(ctx) {
    ctx.fillStyle = C.bgDark;
    ctx.fillRect(0, 0, W, H);

    var g = ctx.createRadialGradient(W / 2, H * 0.38, 80, W / 2, H * 0.38, W);
    g.addColorStop(0, C.bgLight);
    g.addColorStop(0.45, C.bgMid);
    g.addColorStop(1, C.bgDark);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // Leather grain noise (reduced for light themes)
    ctx.globalAlpha = C.isLight ? 0.015 : 0.035;
    for (var i = 0; i < 20000; i++) {
      ctx.fillStyle = C.isLight ? (Math.random() > 0.6 ? '#999' : '#bbb') : (Math.random() > 0.5 ? '#000' : '#FFF');
      ctx.fillRect(
        Math.random() * W | 0,
        Math.random() * H | 0,
        Math.random() * 4 + 1,
        Math.random() * 4 + 1
      );
    }
    ctx.globalAlpha = 1;
  }

  /* ══════════════════════════════════════════════════════════════════════
   *  DOUBLE GOLD BORDER
   * ══════════════════════════════════════════════════════════════════════ */
  function drawBorders(ctx) {
    // Outer thick gold border
    var m1 = 48;
    ctx.strokeStyle = gGrad(ctx, m1, m1, W - m1, H - m1);
    ctx.lineWidth = 16;
    rr(ctx, m1, m1, W - m1 * 2, H - m1 * 2, 18);
    ctx.stroke();

    // Inner thin gold border
    var m2 = 86;
    ctx.strokeStyle = C.gold;
    ctx.lineWidth = 6;
    rr(ctx, m2, m2, W - m2 * 2, H - m2 * 2, 14);
    ctx.stroke();
  }

  /* ══════════════════════════════════════════════════════════════════════
   *  ORNATE VICTORIAN CORNERS — 500px span, elaborate scrollwork
   * ══════════════════════════════════════════════════════════════════════ */
  function drawCornerPiece(ctx) {
    // Draws top-left corner. Caller mirrors for other 3.
    // Total span: 500px on each arm.
    var g = gGrad(ctx, 0, 0, 500, 500);
    ctx.strokeStyle = g;
    ctx.fillStyle = g;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // ═══ STRUCTURAL L-FRAME ═══
    ctx.lineWidth = 18;
    ctx.beginPath();
    ctx.moveTo(0, 480);
    ctx.lineTo(0, 32);
    ctx.quadraticCurveTo(0, 0, 32, 0);
    ctx.lineTo(480, 0);
    ctx.stroke();

    // Inner parallel L-arm
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(32, 440);
    ctx.lineTo(32, 48);
    ctx.quadraticCurveTo(32, 32, 48, 32);
    ctx.lineTo(440, 32);
    ctx.stroke();

    // ═══ MAIN VERTICAL SCROLL (y 160-400) ═══
    // Primary bold C-scroll — outward then curling back
    ctx.lineWidth = 16;
    ctx.beginPath();
    ctx.moveTo(8, 400);
    ctx.bezierCurveTo(90, 388, 135, 325, 120, 265);
    ctx.bezierCurveTo(108, 208, 55, 172, 16, 184);
    ctx.stroke();

    // Inner scroll spiral
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.moveTo(16, 184);
    ctx.bezierCurveTo(52, 178, 82, 210, 88, 252);
    ctx.bezierCurveTo(94, 288, 70, 310, 48, 298);
    ctx.stroke();

    // Innermost curl tip
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(48, 298);
    ctx.bezierCurveTo(60, 292, 72, 270, 68, 254);
    ctx.stroke();

    // Filled teardrop at scroll start
    ctx.beginPath();
    ctx.ellipse(8, 414, 7, 18, 0, 0, Math.PI * 2);
    ctx.fill();

    // ═══ MAIN HORIZONTAL SCROLL (x 160-400) ═══
    ctx.lineWidth = 16;
    ctx.beginPath();
    ctx.moveTo(400, 8);
    ctx.bezierCurveTo(388, 90, 325, 135, 265, 120);
    ctx.bezierCurveTo(208, 108, 172, 55, 184, 16);
    ctx.stroke();

    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.moveTo(184, 16);
    ctx.bezierCurveTo(178, 52, 210, 82, 252, 88);
    ctx.bezierCurveTo(288, 94, 310, 70, 298, 48);
    ctx.stroke();

    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(298, 48);
    ctx.bezierCurveTo(292, 60, 270, 72, 254, 68);
    ctx.stroke();

    ctx.beginPath();
    ctx.ellipse(414, 8, 18, 7, 0, 0, Math.PI * 2);
    ctx.fill();

    // ═══ CORNER FAN MOTIF (0-160) ═══
    // Bold radiating fan curves
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.moveTo(48, 22);
    ctx.bezierCurveTo(105, 58, 140, 110, 120, 175);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(22, 48);
    ctx.bezierCurveTo(58, 105, 110, 140, 175, 120);
    ctx.stroke();

    // Medium fan curves
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(54, 30);
    ctx.bezierCurveTo(92, 62, 112, 100, 96, 145);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(30, 54);
    ctx.bezierCurveTo(62, 92, 100, 112, 145, 96);
    ctx.stroke();

    // Thin inner fan curves
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(58, 40);
    ctx.bezierCurveTo(84, 64, 96, 86, 84, 120);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(40, 58);
    ctx.bezierCurveTo(64, 84, 86, 96, 120, 84);
    ctx.stroke();

    // Diagonal accent curves
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(52, 52);
    ctx.bezierCurveTo(88, 88, 118, 120, 105, 160);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(52, 52);
    ctx.bezierCurveTo(88, 88, 118, 120, 160, 105);
    ctx.stroke();

    // ═══ CENTRAL ROSETTE ═══
    ctx.beginPath();
    ctx.arc(50, 50, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(50, 50, 24, 0, Math.PI * 2);
    ctx.stroke();

    // ═══ DIAMOND ACCENTS ═══
    function diamond(x, y, s) {
      ctx.beginPath();
      ctx.moveTo(x, y - s); ctx.lineTo(x + s, y);
      ctx.lineTo(x, y + s); ctx.lineTo(x - s, y);
      ctx.closePath(); ctx.fill();
    }
    diamond(85, 10, 10);
    diamond(10, 85, 10);
    diamond(135, 8, 8);
    diamond(8, 135, 8);
    diamond(340, 8, 7);
    diamond(8, 340, 7);

    // ═══ ARM-END FLOURISH (400-480) ═══
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.moveTo(8, 452);
    ctx.bezierCurveTo(58, 442, 78, 418, 60, 388);
    ctx.stroke();
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(60, 388);
    ctx.bezierCurveTo(45, 402, 28, 408, 18, 396);
    ctx.stroke();

    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.moveTo(452, 8);
    ctx.bezierCurveTo(442, 58, 418, 78, 388, 60);
    ctx.stroke();
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(388, 60);
    ctx.bezierCurveTo(402, 45, 408, 28, 396, 18);
    ctx.stroke();

    // ═══ LEAF ACCENTS ALONG ARMS ═══
    [168, 225, 285, 345].forEach(function (yy) {
      ctx.beginPath();
      ctx.ellipse(10, yy, 7, 17, 0, 0, Math.PI * 2);
      ctx.fill();
    });
    [168, 225, 285, 345].forEach(function (xx) {
      ctx.beginPath();
      ctx.ellipse(xx, 10, 17, 7, 0, 0, Math.PI * 2);
      ctx.fill();
    });

    // ═══ DOT CLUSTERS NEAR ARM ENDS ═══
    [434, 452, 470].forEach(function (v) {
      ctx.beginPath(); ctx.arc(v, 7, 6, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(7, v, 6, 0, Math.PI * 2); ctx.fill();
    });

    // ═══ ACCENT DOTS ALONG SCROLL PATH ═══
    [[85, 355], [105, 300], [115, 258]].forEach(function (p) {
      ctx.beginPath(); ctx.arc(p[0], p[1], 5, 0, Math.PI * 2); ctx.fill();
    });
    [[355, 85], [300, 105], [258, 115]].forEach(function (p) {
      ctx.beginPath(); ctx.arc(p[0], p[1], 5, 0, Math.PI * 2); ctx.fill();
    });

    ctx.lineCap = 'butt';
    ctx.lineJoin = 'miter';
  }

  function drawCorners(ctx) {
    var m = 50;
    var positions = [
      { x: m,     y: m,     sx: 1,  sy: 1 },
      { x: W - m, y: m,     sx: -1, sy: 1 },
      { x: m,     y: H - m, sx: 1,  sy: -1 },
      { x: W - m, y: H - m, sx: -1, sy: -1 }
    ];
    positions.forEach(function (p) {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.scale(p.sx, p.sy);
      drawCornerPiece(ctx);
      ctx.restore();
    });
  }

  /* ══════════════════════════════════════════════════════════════════════
   *  BRANDING — Hotel logo + centered hotel name + city
   * ══════════════════════════════════════════════════════════════════════ */
  async function drawBranding(ctx, cfg) {
    var cx = W / 2;
    var y = 200;

    // --- Hotel logo (square, from API) or fallback K badge ---
    var logoSz = 160;
    var logoR = 24;
    var logoX = (W - logoSz) / 2;
    var logoY = y;
    var logoImg = null;

    if (cfg.logoUrl && cfg.hotelId) {
      logoImg = await loadImg('/api/logo/' + cfg.hotelId + '?v=' + Date.now());
    }

    if (logoImg) {
      // White background for logo
      ctx.fillStyle = C.white;
      rr(ctx, logoX - 6, logoY - 6, logoSz + 12, logoSz + 12, logoR + 4);
      ctx.fill();
      // Gold border
      ctx.strokeStyle = C.gold;
      ctx.lineWidth = 4;
      rr(ctx, logoX - 6, logoY - 6, logoSz + 12, logoSz + 12, logoR + 4);
      ctx.stroke();
      // Clip and draw logo
      ctx.save();
      rr(ctx, logoX, logoY, logoSz, logoSz, logoR);
      ctx.clip();
      ctx.drawImage(logoImg, logoX, logoY, logoSz, logoSz);
      ctx.restore();
    } else {
      // Fallback: orange K badge
      ctx.fillStyle = C.kBadge;
      rr(ctx, logoX, logoY, logoSz, logoSz, logoR);
      ctx.fill();
      ctx.fillStyle = C.white;
      ctx.font = 'bold 110px Georgia, "Times New Roman", serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('K', cx, logoY + logoSz / 2);
    }

    y = logoY + logoSz + 80;

    // --- Hotel name — LARGE, centered, cream with gold glow ---
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.save();
    ctx.shadowColor = C.shadowGlow || 'rgba(197,165,90,0.3)';
    ctx.shadowBlur = 20;
    ctx.fillStyle = C.cream;
    ctx.font = 'bold 120px Georgia, "Times New Roman", serif';
    var displayName = truncName(ctx, cfg.name || 'Restaurant', W - 300);
    ctx.fillText(displayName, cx, y);
    ctx.restore();

    y += 100;

    // --- City below name ---
    if (cfg.city) {
      ctx.fillStyle = C.gold;
      ctx.font = '400 60px Georgia, "Times New Roman", serif';
      ctx.fillText('\u25C6 ' + cfg.city, cx, y);
      y += 50;
    } else {
      y += 14;
    }

    ctx.textBaseline = 'alphabetic';
    return y;
  }

  /* ══════════════════════════════════════════════════════════════════════
   *  TITLE — large gold serif "MENU" / "REVIEW" / "PAY"
   * ══════════════════════════════════════════════════════════════════════ */
  function drawTitle(ctx, text, startY) {
    var cx = W / 2;
    var y = startY + 120;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 220px Georgia, "Times New Roman", serif';
    var tw = ctx.measureText(text).width;

    // Gold glow behind title
    ctx.save();
    ctx.shadowColor = C.shadowGold || 'rgba(197,165,90,0.5)';
    ctx.shadowBlur = 40;
    ctx.fillStyle = gGrad(ctx, cx - tw / 2, y - 100, cx + tw / 2, y + 100);
    ctx.fillText(text, cx, y);
    ctx.restore();

    // Ornamental underline: twin lines with center diamond
    y += 105;
    var lw = Math.min(tw + 120, 900);
    ctx.strokeStyle = C.gold;
    ctx.lineWidth = 4;
    // Left line
    ctx.beginPath();
    ctx.moveTo(cx - lw / 2, y);
    ctx.lineTo(cx - 18, y);
    ctx.stroke();
    // Right line
    ctx.beginPath();
    ctx.moveTo(cx + 18, y);
    ctx.lineTo(cx + lw / 2, y);
    ctx.stroke();
    // Thin parallel lines
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.4;
    ctx.beginPath();
    ctx.moveTo(cx - lw / 2 + 40, y - 12);
    ctx.lineTo(cx - 30, y - 12);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx + 30, y - 12);
    ctx.lineTo(cx + lw / 2 - 40, y - 12);
    ctx.stroke();
    ctx.globalAlpha = 1;
    // Center diamond
    ctx.fillStyle = C.gold;
    ctx.beginPath();
    ctx.moveTo(cx, y - 14); ctx.lineTo(cx + 14, y);
    ctx.lineTo(cx, y + 14); ctx.lineTo(cx - 14, y);
    ctx.closePath(); ctx.fill();
    // End cap diamonds
    ctx.beginPath();
    ctx.moveTo(cx - lw / 2, y - 6); ctx.lineTo(cx - lw / 2 + 6, y);
    ctx.lineTo(cx - lw / 2, y + 6); ctx.lineTo(cx - lw / 2 - 6, y);
    ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx + lw / 2, y - 6); ctx.lineTo(cx + lw / 2 + 6, y);
    ctx.lineTo(cx + lw / 2, y + 6); ctx.lineTo(cx + lw / 2 - 6, y);
    ctx.closePath(); ctx.fill();

    return y + 30;
  }

  /* ══════════════════════════════════════════════════════════════════════
   *  QR CODE — in white box with ornate gold frame
   * ══════════════════════════════════════════════════════════════════════ */
  async function drawQR(ctx, qrSvg, startY) {
    var cx = W / 2;
    var qrSize = 1850;
    var pad = 15;
    var boxSz = qrSize + pad * 2;
    var framePad = 18;
    var frameSz = boxSz + framePad * 2;
    var fx = (W - frameSz) / 2;
    var fy = startY;
    var bx = fx + framePad;
    var by = fy + framePad;

    // --- Outer gold frame (thick, with glow) ---
    ctx.save();
    ctx.shadowColor = C.shadowGold || 'rgba(197,165,90,0.4)';
    ctx.shadowBlur = 50;
    ctx.strokeStyle = gGrad(ctx, fx, fy, fx + frameSz, fy + frameSz);
    ctx.lineWidth = 16;
    rr(ctx, fx, fy, frameSz, frameSz, 24);
    ctx.stroke();
    ctx.restore();

    // --- Inner decorative gold line ---
    ctx.strokeStyle = C.gold;
    ctx.lineWidth = 5;
    rr(ctx, fx + 24, fy + 24, frameSz - 48, frameSz - 48, 18);
    ctx.stroke();

    // --- Ornate corner brackets on QR frame ---
    var cl = 90;
    var co = 8;
    ctx.lineCap = 'round';
    [[fx + co, fy + co, 1, 1],
     [fx + frameSz - co, fy + co, -1, 1],
     [fx + co, fy + frameSz - co, 1, -1],
     [fx + frameSz - co, fy + frameSz - co, -1, -1]].forEach(function (c) {
      var cx2 = c[0], cy2 = c[1], sx = c[2], sy = c[3];
      // Outer L-bracket
      ctx.strokeStyle = C.goldHi;
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.moveTo(cx2, cy2 + sy * cl);
      ctx.lineTo(cx2, cy2);
      ctx.lineTo(cx2 + sx * cl, cy2);
      ctx.stroke();
      // Inner L-bracket
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(cx2 + sx * 12, cy2 + sy * (cl - 18));
      ctx.lineTo(cx2 + sx * 12, cy2 + sy * 12);
      ctx.lineTo(cx2 + sx * (cl - 18), cy2 + sy * 12);
      ctx.stroke();
      // Diamond accent
      ctx.fillStyle = C.goldHi;
      ctx.beginPath();
      ctx.moveTo(cx2, cy2 + sy * 14);
      ctx.lineTo(cx2 + sx * 14, cy2);
      ctx.lineTo(cx2, cy2 - sy * 14);
      ctx.lineTo(cx2 - sx * 14, cy2);
      ctx.closePath();
      ctx.fill();
      // Small scroll accent
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(cx2 + sx * 24, cy2 + sy * 24);
      ctx.bezierCurveTo(cx2 + sx * 40, cy2 + sy * 14, cx2 + sx * 50, cy2 + sy * 8, cx2 + sx * 62, cy2 + sy * 16);
      ctx.stroke();
    });
    ctx.lineCap = 'butt';

    // --- White background ---
    ctx.fillStyle = C.white;
    rr(ctx, bx, by, boxSz, boxSz, 16);
    ctx.fill();

    // --- QR image ---
    var qrImg = await loadQrImage(qrSvg);
    if (qrImg) {
      ctx.drawImage(qrImg, bx + pad, by + pad, qrSize, qrSize);
    }

    return fy + frameSz + 65;
  }

  /* ══════════════════════════════════════════════════════════════════════
   *  CTA SECTIONS
   * ══════════════════════════════════════════════════════════════════════ */
  function drawMenuCTA(ctx, y) {
    var cx = W / 2;

    // Ornamental divider with scroll ends
    var dw = 500;
    ctx.strokeStyle = C.gold;
    ctx.lineWidth = 3;
    ctx.globalAlpha = 0.6;
    // Left line with curl
    ctx.beginPath();
    ctx.moveTo(cx - dw / 2, y - 20);
    ctx.lineTo(cx - 14, y - 20);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx - dw / 2, y - 20, 8, 0, Math.PI, true);
    ctx.stroke();
    // Right line with curl
    ctx.beginPath();
    ctx.moveTo(cx + 14, y - 20);
    ctx.lineTo(cx + dw / 2, y - 20);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx + dw / 2, y - 20, 8, 0, Math.PI, false);
    ctx.stroke();
    ctx.globalAlpha = 1;
    // Center diamond
    ctx.fillStyle = C.gold;
    ctx.beginPath();
    ctx.moveTo(cx, y - 28); ctx.lineTo(cx + 8, y - 20);
    ctx.lineTo(cx, y - 12); ctx.lineTo(cx - 8, y - 20);
    ctx.closePath(); ctx.fill();

    y += 40;
    ctx.textAlign = 'center';
    ctx.fillStyle = C.cream;
    ctx.font = '600 96px Georgia, "Times New Roman", serif';
    ctx.fillText('Scan  \u279C  Tap  \u279C  View Menu', cx, y);

    // Small decorative dots between CTA lines
    y += 65;
    ctx.fillStyle = C.gold;
    ctx.globalAlpha = 0.5;
    ctx.beginPath(); ctx.arc(cx - 30, y, 4, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(cx, y, 5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(cx + 30, y, 4, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;

    y += 55;
    ctx.fillStyle = C.creamSoft;
    ctx.font = 'italic 56px Georgia, "Times New Roman", serif';
    ctx.fillText('Open Menu:', cx, y);
    return y + 80;
  }

  function drawReviewCTA(ctx, y) {
    var cx = W / 2;

    // Ornamental divider with scroll ends
    var dw = 500;
    ctx.strokeStyle = C.gold;
    ctx.lineWidth = 3;
    ctx.globalAlpha = 0.6;
    ctx.beginPath();
    ctx.moveTo(cx - dw / 2, y - 20);
    ctx.lineTo(cx - 14, y - 20);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx - dw / 2, y - 20, 8, 0, Math.PI, true);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx + 14, y - 20);
    ctx.lineTo(cx + dw / 2, y - 20);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx + dw / 2, y - 20, 8, 0, Math.PI, false);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = C.gold;
    ctx.beginPath();
    ctx.moveTo(cx, y - 28); ctx.lineTo(cx + 8, y - 20);
    ctx.lineTo(cx, y - 12); ctx.lineTo(cx - 8, y - 20);
    ctx.closePath(); ctx.fill();

    y += 40;
    ctx.textAlign = 'center';
    ctx.fillStyle = C.cream;
    ctx.font = '600 96px Georgia, "Times New Roman", serif';
    ctx.fillText('\u2B50 Enjoyed your meal?', cx, y);

    y += 65;
    ctx.fillStyle = C.gold;
    ctx.globalAlpha = 0.5;
    ctx.beginPath(); ctx.arc(cx - 30, y, 4, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(cx, y, 5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(cx + 30, y, 4, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;

    y += 55;
    ctx.fillStyle = C.creamSoft;
    ctx.font = 'italic 56px Georgia, "Times New Roman", serif';
    ctx.fillText('Tap to leave us a review!', cx, y);
    return y + 80;
  }

  function drawUpiCTA(ctx, y) {
    var cx = W / 2;

    // Ornamental divider with scroll ends
    var dw = 500;
    ctx.strokeStyle = C.gold;
    ctx.lineWidth = 3;
    ctx.globalAlpha = 0.6;
    ctx.beginPath();
    ctx.moveTo(cx - dw / 2, y - 20);
    ctx.lineTo(cx - 14, y - 20);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx - dw / 2, y - 20, 8, 0, Math.PI, true);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx + 14, y - 20);
    ctx.lineTo(cx + dw / 2, y - 20);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx + dw / 2, y - 20, 8, 0, Math.PI, false);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = C.gold;
    ctx.beginPath();
    ctx.moveTo(cx, y - 28); ctx.lineTo(cx + 8, y - 20);
    ctx.lineTo(cx, y - 12); ctx.lineTo(cx - 8, y - 20);
    ctx.closePath(); ctx.fill();

    y += 40;
    ctx.textAlign = 'center';
    ctx.fillStyle = C.cream;
    ctx.font = '600 96px Georgia, "Times New Roman", serif';
    ctx.fillText('\uD83D\uDCB0 Scan to Pay', cx, y);

    y += 65;
    ctx.fillStyle = C.gold;
    ctx.globalAlpha = 0.5;
    ctx.beginPath(); ctx.arc(cx - 30, y, 4, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(cx, y, 5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(cx + 30, y, 4, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;

    y += 55;
    ctx.fillStyle = C.creamSoft;
    ctx.font = 'italic 56px Georgia, "Times New Roman", serif';
    ctx.fillText('Pay via UPI \u2022 PhonePe, GPay, Paytm', cx, y);
    return y + 80;
  }

  /* ══════════════════════════════════════════════════════════════════════
   *  URL PILL — gold metallic
   * ══════════════════════════════════════════════════════════════════════ */
  function drawURL(ctx, slug, y) {
    var cx = W / 2;
    var txt = 'kodspot.com/m/' + slug;
    ctx.font = '600 76px Georgia, "Times New Roman", serif';
    var tw = ctx.measureText(txt).width;
    var pw = tw + 140;
    var ph = 110;
    var px = (W - pw) / 2;
    var py = y - ph / 2;

    // Pill shadow for depth
    ctx.save();
    ctx.shadowColor = C.shadowGold || 'rgba(197,165,90,0.35)';
    ctx.shadowBlur = 30;
    ctx.shadowOffsetY = 6;
    ctx.fillStyle = gGrad(ctx, px, py, px + pw, py + ph);
    rr(ctx, px, py, pw, ph, ph / 2);
    ctx.fill();
    ctx.restore();

    // Highlight border
    ctx.strokeStyle = C.goldHi;
    ctx.lineWidth = 3;
    rr(ctx, px + 3, py + 3, pw - 6, ph - 6, (ph - 6) / 2);
    ctx.stroke();

    ctx.fillStyle = C.pillTxt || C.bgDark;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(txt, cx, y + 2);
    ctx.textBaseline = 'alphabetic';

    return y + ph / 2 + 50;
  }

  /* ══════════════════════════════════════════════════════════════════════
   *  FLIP HINT (back side)
   * ══════════════════════════════════════════════════════════════════════ */
  function drawFlipHint(ctx, y) {
    var cx = W / 2;
    ctx.fillStyle = C.creamSoft;
    ctx.font = '400 44px Georgia, "Times New Roman", serif';
    ctx.textAlign = 'center';
    ctx.globalAlpha = 0.65;
    ctx.fillText('\uD83D\uDCF1 For menu, flip this card', cx, y);
    ctx.globalAlpha = 1;
    return y + 50;
  }

  /* ══════════════════════════════════════════════════════════════════════
   *  FOOTER — "kodspot.com" + optional powered-by
   * ══════════════════════════════════════════════════════════════════════ */
  function drawFooter(ctx, plan) {
    var cx = W / 2;
    // Bottom-anchored: 114px margin from inner border, symmetric with top
    var innerBottom = H - 86;
    var y = (plan !== 'PRO')
      ? innerBottom - 144   // "kodspot.com" here, "Powered by" 50px below
      : innerBottom - 94;   // "kodspot.com" here, PRO plan

    // Elegant gold separator with diamond
    var dw2 = 360;
    ctx.strokeStyle = C.gold;
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.moveTo(cx - dw2 / 2, y - 45);
    ctx.lineTo(cx - 14, y - 45);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx + 14, y - 45);
    ctx.lineTo(cx + dw2 / 2, y - 45);
    ctx.stroke();
    // Thin second line
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - dw2 / 2 + 30, y - 38);
    ctx.lineTo(cx - 20, y - 38);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx + 20, y - 38);
    ctx.lineTo(cx + dw2 / 2 - 30, y - 38);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = C.gold;
    ctx.beginPath();
    ctx.moveTo(cx, y - 53); ctx.lineTo(cx + 8, y - 45);
    ctx.lineTo(cx, y - 37); ctx.lineTo(cx - 8, y - 45);
    ctx.closePath(); ctx.fill();

    ctx.textAlign = 'center';
    ctx.fillStyle = C.gold;
    ctx.font = '600 50px Georgia, "Times New Roman", serif';
    ctx.save();
    ctx.shadowColor = C.shadowGlow || 'rgba(197,165,90,0.3)';
    ctx.shadowBlur = 14;
    ctx.fillText('kodspot.com', cx, y);
    ctx.restore();

    if (plan !== 'PRO') {
      ctx.fillStyle = C.footerTxt;
      ctx.font = '400 34px Georgia, "Times New Roman", serif';
      ctx.fillText('Powered by KodSpot', cx, y + 50);
    }
  }

  /* ══════════════════════════════════════════════════════════════════════
   *  SHARED CARD SCAFFOLD — all the premium framing
   * ══════════════════════════════════════════════════════════════════════ */
  function drawFrame(ctx) {
    drawBg(ctx);
    drawBorders(ctx);
    drawCorners(ctx);
  }

  /* ══════════════════════════════════════════════════════════════════════
   *  GENERATE FRONT SIDE
   * ══════════════════════════════════════════════════════════════════════ */
  async function generateFront(cfg) {
    if (!cfg.qrSvg || !cfg.slug) return null;
    C = THEMES[cfg.qrTheme] || THEMES.walnut;

    var canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    var ctx = canvas.getContext('2d');

    drawFrame(ctx);
    var y = await drawBranding(ctx, cfg);
    y = drawTitle(ctx, 'MENU', y);
    y = await drawQR(ctx, cfg.qrSvg, y);
    y = drawMenuCTA(ctx, y);
    y = drawURL(ctx, cfg.slug, y);
    drawFooter(ctx, cfg.plan, y);

    return new Promise(function (ok) { canvas.toBlob(ok, 'image/png', 1.0); });
  }

  /* ══════════════════════════════════════════════════════════════════════
   *  GENERATE BACK SIDE
   * ══════════════════════════════════════════════════════════════════════ */
  async function generateBack(cfg) {
    var hasReview = !!(cfg.reviewUrl && cfg.reviewQrSvg);
    var hasUpi = !!(cfg.upiId && cfg.upiQrSvg);
    if (!hasReview && !hasUpi) return generateFront(cfg);

    var useReview = hasReview;
    var useUpi = !hasReview && hasUpi;
    if (!cfg.slug) return null;
    C = THEMES[cfg.qrTheme] || THEMES.walnut;

    var canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    var ctx = canvas.getContext('2d');

    drawFrame(ctx);
    var y = await drawBranding(ctx, cfg);

    if (useReview) {
      y = drawTitle(ctx, 'REVIEW', y);
    } else {
      y = drawTitle(ctx, 'PAY', y);
    }

    if (useReview) {
      y = await drawQR(ctx, cfg.reviewQrSvg, y);
      y = drawReviewCTA(ctx, y);
    } else if (useUpi) {
      y = await drawQR(ctx, cfg.upiQrSvg, y);
      y = drawUpiCTA(ctx, y);
    } else {
      y = await drawQR(ctx, cfg.qrSvg, y);
    }

    y = drawFlipHint(ctx, y);
    drawFooter(ctx, cfg.plan, y);

    return new Promise(function (ok) { canvas.toBlob(ok, 'image/png', 1.0); });
  }

  /* ══════════════════════════════════════════════════════════════════════
   *  GENERATE PRINT-READY (both sides stacked)
   * ══════════════════════════════════════════════════════════════════════ */
  async function generatePrintReady(cfg) {
    var fb = await generateFront(cfg);
    var bb = await generateBack(cfg);
    if (!fb || !bb) return null;

    var fu = URL.createObjectURL(fb);
    var bu = URL.createObjectURL(bb);
    var fi = await loadImg(fu);
    var bi = await loadImg(bu);
    URL.revokeObjectURL(fu);
    URL.revokeObjectURL(bu);
    if (!fi || !bi) return null;

    var gap = 120;
    var lh = 80;
    var totalH = H + gap + lh + H + gap + lh;
    var canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = totalH;
    var ctx = canvas.getContext('2d');

    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, W, totalH);

    // Front label
    ctx.fillStyle = C.gold;
    ctx.font = '600 48px Georgia, "Times New Roman", serif';
    ctx.textAlign = 'center';
    ctx.fillText('\u2702 FRONT SIDE \u2014 Cut along dotted line', W / 2, 56);
    ctx.strokeStyle = C.gold;
    ctx.lineWidth = 3;
    ctx.globalAlpha = 0.4;
    ctx.setLineDash([20, 12]);
    ctx.beginPath(); ctx.moveTo(40, lh); ctx.lineTo(W - 40, lh); ctx.stroke();
    ctx.setLineDash([]); ctx.globalAlpha = 1;
    ctx.drawImage(fi, 0, lh);

    // Back label
    var midY = lh + H + gap / 2;
    ctx.fillStyle = C.gold;
    ctx.font = '600 48px Georgia, "Times New Roman", serif';
    ctx.fillText('\u2702 BACK SIDE \u2014 Cut along dotted line', W / 2, midY + 24);
    ctx.strokeStyle = C.gold;
    ctx.lineWidth = 3;
    ctx.globalAlpha = 0.4;
    ctx.setLineDash([20, 12]);
    ctx.beginPath(); ctx.moveTo(40, midY + gap / 2); ctx.lineTo(W - 40, midY + gap / 2); ctx.stroke();
    ctx.setLineDash([]); ctx.globalAlpha = 1;
    ctx.drawImage(bi, 0, lh + H + gap + lh);

    return new Promise(function (ok) { canvas.toBlob(ok, 'image/png', 1.0); });
  }

  /* ══════════════════════════════════════════════════════════════════════
   *  DOWNLOAD HELPER
   * ══════════════════════════════════════════════════════════════════════ */
  function downloadBlob(blob, filename) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
  }

  /* ══════════════════════════════════════════════════════════════════════
   *  PUBLIC API
   * ══════════════════════════════════════════════════════════════════════ */
  return {
    generateFront: generateFront,
    generateBack: generateBack,
    generatePrintReady: generatePrintReady,
    downloadBlob: downloadBlob,
    safeName: safeName,
    W: W,
    H: H,
    THEMES: THEMES
  };
})();
