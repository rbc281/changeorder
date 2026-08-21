(() => {
  "use strict";

  const BUILD_VERSION = "20260820complete1";
  const TEMPLATE_PATH = `./change-order-template.pdf?v=${BUILD_VERSION}`;
  const MAX_CHANGES = 10;
  const TODAY = new Date();

  // Fixed rectangles from the supplied 2026 Change Order PDF.
  // V5 draws directly onto the page instead of filling AcroForm fields.
  // This avoids malformed /DA and signature appearance metadata in the source PDF.
  const PDF_BOXES = {
    contractDate: [121, 654, 221, 669],
    orderNumber: [274, 654, 394, 669],
    changeOrderDate: [443, 654, 542, 669],
    customer1: [158, 636, 543, 651],
    customer2: [157, 620, 542, 635],
    consultant: [158, 605, 543, 619],
    installAddress: [158, 589, 542, 603],
    financeProgram: [229, 354, 542, 368],
    financePlan: [229, 339, 542, 353],
    depositCheck: [229, 290, 322, 304],
    depositCredit: [325, 291, 434, 305],
    depositFinance: [437, 289, 541, 303],
    progressCheck: [229, 274, 322, 288],
    progressCredit: [325, 274, 434, 288],
    progressFinance: [437, 274, 541, 288],
    installationCheck: [229, 258, 323, 272],
    installationCredit: [325, 258, 434, 272],
    installationFinance: [436, 258, 543, 272],
    previousPrice: [439, 232, 546, 246],
    changeAmount: [439, 215, 546, 229],
    newPrice: [439, 198, 546, 212],
    customer1Date: [404, 168, 551, 182],
    customer2Date: [404, 139, 551, 153],
    managementDate: [404, 112, 551, 126],
  };
  PDF_BOXES.changeRows = [
    [[47, 518, 105, 532], [107, 518, 227, 532], [230, 518, 543, 532]],
    [[48, 501, 105, 515], [107, 501, 226, 515], [230, 502, 542, 516]],
    [[47, 485, 104, 499], [107, 486, 227, 500], [230, 485, 542, 499]],
    [[47, 468, 105, 482], [108, 470, 227, 484], [229, 469, 542, 483]],
    [[48, 453, 104, 467], [107, 452, 226, 466], [229, 452, 542, 466]],
    [[47, 437, 104, 451], [108, 437, 227, 451], [229, 437, 542, 451]],
    [[48, 421, 105, 435], [108, 420, 228, 434], [229, 420, 542, 434]],
    [[47, 404, 105, 418], [107, 404, 226, 418], [229, 404, 542, 418]],
    [[48, 387, 105, 401], [108, 388, 227, 402], [230, 388, 543, 402]],
    [[48, 371, 106, 385], [108, 371, 228, 385], [229, 372, 542, 386]],
  ].map(([unit, room, change]) => ({ unit, room, change }));

  // Widget rectangles in PDF points, used only to place optional handwritten signatures.
  const SIGNATURE_RECTS = {
    signature1: { x: 165, y: 167, width: 172, height: 20 },
    signature2: { x: 165, y: 139, width: 172, height: 20 }
  };

  const $ = (id) => document.getElementById(id);
  const formEl = $("changeOrderForm");
  const changesList = $("changesList");
  const financeFields = $("financeFields");
  const oopMethodWrap = $("oopMethodWrap");
  const reviewDialog = $("reviewDialog");
  const successDialog = $("successDialog");
  const formError = $("formError");

  let changes = [];
  let lastGeneratedBlob = null;
  let lastGeneratedFilename = "Change Order.pdf";
  let isGenerating = false;

  function pad2(n) { return String(n).padStart(2, "0"); }
  function dateForInput(d) { return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`; }
  function dateForPdf(inputValue) {
    if (!inputValue) return "";
    const [y,m,d] = inputValue.split("-");
    return `${m}/${d}/${y}`;
  }
  function todayForPdf() { return `${pad2(TODAY.getMonth()+1)}/${pad2(TODAY.getDate())}/${TODAY.getFullYear()}`; }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "'":"&#39;", '"':"&quot;" }[c]));
  }

  function parseMoneyToCents(value) {
    let raw = String(value || "").trim();
    if (raw === "") return 0;
    raw = raw.replace(/[$,\s]/g, "");
    if (raw === "" || raw === "." || raw === "-") return 0;
    const negative = raw.startsWith("-");
    if (negative) raw = raw.slice(1);
    const parts = raw.split(".");
    let whole = (parts[0] || "0").replace(/[^\d]/g, "");
    let decimal = (parts[1] || "").replace(/[^\d]/g, "");
    const dollars = parseInt(whole || "0", 10);
    const cents = parseInt((decimal + "00").slice(0, 2), 10);
    const total = dollars * 100 + cents;
    return negative ? -total : total;
  }

  function money(cents, signed = false) {
    cents = Math.trunc(Number(cents) || 0);
    const negative = cents < 0;
    const absolute = Math.abs(cents);
    const dollars = Math.floor(absolute / 100).toLocaleString("en-US");
    const centPart = String(absolute % 100).padStart(2, "0");
    const sign = negative ? "-" : (signed && cents > 0 ? "+" : "");
    return `${sign}$${dollars}.${centPart}`;
  }

  // Mirrors the current PAF Calculator logic exactly:
  // deposit <= min(10% of project, $1,000); 33% total due through progress;
  // remaining balance at installation; out-of-pocket is applied sequentially first.
  function calculatePaymentSchedule(projectTotal, outOfPocket, method) {
    projectTotal = Math.max(0, Math.trunc(projectTotal || 0));
    outOfPocket = Math.max(0, Math.min(Math.trunc(outOfPocket || 0), projectTotal));

    const amountFinanced = projectTotal - outOfPocket;
    const initialDepositLimit = Math.min(Math.trunc(projectTotal * 10 / 100), 100000);
    const payment1 = outOfPocket > 0 ? Math.min(outOfPocket, initialDepositLimit) : 0;
    const requiredDepositTotal = Math.trunc(projectTotal * 33 / 100);
    const payment2 = Math.max(requiredDepositTotal - payment1, 0);
    const payment3 = projectTotal - payment1 - payment2;

    let remainingOop = outOfPocket;
    const oop1 = Math.min(remainingOop, payment1); remainingOop -= oop1;
    const oop2 = Math.min(remainingOop, payment2); remainingOop -= oop2;
    const oop3 = Math.min(remainingOop, payment3); remainingOop -= oop3;

    const fin1 = payment1 - oop1;
    const fin2 = payment2 - oop2;
    const fin3 = payment3 - oop3;

    const allocation = (oop, fin, total) => ({
      check: method === "check" ? oop : 0,
      credit: method === "credit" ? oop : 0,
      finance: fin,
      total
    });

    return {
      amountFinanced,
      deposit: allocation(oop1, fin1, payment1),
      progress: allocation(oop2, fin2, payment2),
      installation: allocation(oop3, fin3, payment3)
    };
  }

  function addChange(prefill = {}) {
    if (changes.length >= MAX_CHANGES) return;
    changes.push({
      id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
      unit: prefill.unit || "",
      room: prefill.room || "",
      change: prefill.change || ""
    });
    renderChanges();
  }

  function renderChanges() {
    changesList.innerHTML = changes.map((item, index) => `
      <div class="change-item" data-change-id="${item.id}">
        <div class="change-top">
          <div class="change-number">Change #${index + 1}</div>
          ${changes.length > 1 ? `<button class="remove-change" type="button" data-remove-change="${item.id}">Remove</button>` : ""}
        </div>
        <div class="change-fields">
          <div>
            <label>Unit # <span class="req">Required</span></label>
            <input data-change-field="unit" maxlength="12" value="${escapeHtml(item.unit)}" placeholder="e.g. 3" required />
          </div>
          <div>
            <label>Room / Description <span class="req">Required</span></label>
            <input data-change-field="room" maxlength="32" value="${escapeHtml(item.room)}" placeholder="e.g. Living Room" required />
          </div>
          <div class="change-description">
            <label>What is changing? <span class="req">Required</span></label>
            <input data-change-field="change" maxlength="110" value="${escapeHtml(item.change)}" placeholder="Describe the revision" required />
            <div class="char-count"><span>${item.change.length}</span>/110</div>
          </div>
        </div>
      </div>
    `).join("");

    $("addChangeBtn").disabled = changes.length >= MAX_CHANGES;
    $("addChangeBtn").textContent = changes.length >= MAX_CHANGES ? "Maximum of 10 Changes Reached" : "+ Add Another Change";
  }

  function syncChangeInput(target) {
    const itemEl = target.closest(".change-item");
    if (!itemEl) return;
    const item = changes.find(c => c.id === itemEl.dataset.changeId);
    if (!item) return;
    const field = target.dataset.changeField;
    if (field) item[field] = target.value;
    const count = itemEl.querySelector(".char-count span");
    if (count && field === "change") count.textContent = target.value.length;
  }

  function removeChange(id) {
    if (changes.length <= 1) return;
    changes = changes.filter(c => c.id !== id);
    renderChanges();
  }

  function selectedOopMethod() {
    return document.querySelector('input[name="oopMethod"]:checked')?.value || "";
  }

  function calculateLive() {
    const previous = parseMoneyToCents($("previousPrice").value);
    const projectTotal = parseMoneyToCents($("newPrice").value);
    const outOfPocket = parseMoneyToCents($("outOfPocket").value);
    const changeAmount = projectTotal - previous;
    const method = selectedOopMethod();

    const changeEl = $("changeAmountDisplay");
    changeEl.textContent = money(changeAmount, true);
    changeEl.classList.toggle("positive", changeAmount > 0);
    changeEl.classList.toggle("negative", changeAmount < 0);

    // A blank out-of-pocket field means $0 out of pocket / fully financed.
    const financingNeeded = projectTotal > 0 && outOfPocket < projectTotal;
    financeFields.classList.toggle("hidden", !financingNeeded);
    $("financeProgram").required = financingNeeded;
    $("financePlan").required = financingNeeded;

    const oopMethodNeeded = outOfPocket > 0;
    oopMethodWrap.classList.toggle("hidden", !oopMethodNeeded);
    document.querySelectorAll('input[name="oopMethod"]').forEach(r => r.required = oopMethodNeeded);

    const calc = calculatePaymentSchedule(projectTotal, outOfPocket, method);
    const rows = [
      ["dep", calc.deposit],
      ["prog", calc.progress],
      ["inst", calc.installation]
    ];
    rows.forEach(([prefix, row]) => {
      $(`${prefix}Check`).textContent = money(row.check);
      $(`${prefix}Credit`).textContent = money(row.credit);
      $(`${prefix}Finance`).textContent = money(row.finance);
      $(`${prefix}Total`).textContent = money(row.total);
    });
    $("financeSummary").textContent = `Amount financed: ${money(calc.amountFinanced)}`;

    // Signature 2 is only useful when a second customer is named.
    $("signature2Card").classList.toggle("hidden", !$("customer2").value.trim());
  }

  function markInvalid(el, invalid) {
    if (!el) return;
    el.classList.toggle("invalid", !!invalid);
  }

  function validateForm() {
    document.querySelectorAll(".invalid").forEach(el => el.classList.remove("invalid"));
    formError.classList.add("hidden");
    const errors = [];

    const requiredIds = ["contractDate", "orderNumber", "consultant", "customer1", "installAddress", "previousPrice", "newPrice"];
    requiredIds.forEach(id => {
      const el = $(id);
      if (!String(el.value || "").trim()) {
        markInvalid(el, true);
        errors.push(`${el.closest(".field")?.querySelector("label")?.childNodes[0]?.textContent?.trim() || id} is required.`);
      }
    });

    changes.forEach((change, index) => {
      const itemEl = changesList.querySelector(`[data-change-id="${change.id}"]`);
      ["unit", "room", "change"].forEach(field => {
        if (!String(change[field] || "").trim()) {
          const input = itemEl?.querySelector(`[data-change-field="${field}"]`);
          markInvalid(input, true);
          errors.push(`Change #${index + 1} is incomplete.`);
        }
      });
    });

    const previous = parseMoneyToCents($("previousPrice").value);
    const newPrice = parseMoneyToCents($("newPrice").value);
    const oop = parseMoneyToCents($("outOfPocket").value);

    if (previous <= 0) { markInvalid($("previousPrice"), true); errors.push("Previous Project Price must be greater than $0."); }
    if (newPrice <= 0) { markInvalid($("newPrice"), true); errors.push("New Project Price must be greater than $0."); }
    if (oop < 0) { markInvalid($("outOfPocket"), true); errors.push("Out-of-pocket amount cannot be negative."); }
    if (newPrice > 0 && oop > newPrice) { markInvalid($("outOfPocket"), true); errors.push("Out-of-pocket amount cannot exceed the New Project Price."); }

    if (oop > 0 && !selectedOopMethod()) errors.push("Select Check or Credit Card for the out-of-pocket payment method.");

    const financingNeeded = newPrice > 0 && oop < newPrice;
    if (financingNeeded) {
      if (!$("financeProgram").value) { markInvalid($("financeProgram"), true); errors.push("Finance Program is required when financing is used."); }
      if (!$("financePlan").value.trim()) { markInvalid($("financePlan"), true); errors.push("Finance Plan # / Application ID is required when financing is used."); }
    }

    if (errors.length) {
      const unique = [...new Set(errors)];
      formError.textContent = unique[0] + (unique.length > 1 ? ` Plus ${unique.length - 1} more item${unique.length > 2 ? "s" : ""} to complete.` : "");
      formError.classList.remove("hidden");
      const firstInvalid = document.querySelector(".invalid") || formError;
      firstInvalid.scrollIntoView({ behavior: "smooth", block: "center" });
      return false;
    }
    return true;
  }

  function getFormData() {
    const previous = parseMoneyToCents($("previousPrice").value);
    const newPrice = parseMoneyToCents($("newPrice").value);
    const outOfPocket = parseMoneyToCents($("outOfPocket").value);
    const method = selectedOopMethod();
    const schedule = calculatePaymentSchedule(newPrice, outOfPocket, method);
    const selectedFinance = $("financeProgram").value ? $("financeProgram").value.split("|") : ["", ""];
    return {
      contractDate: $("contractDate").value,
      orderNumber: $("orderNumber").value.trim(),
      changeOrderDate: todayForPdf(),
      consultant: $("consultant").value.trim(),
      customer1: $("customer1").value.trim(),
      customer2: $("customer2").value.trim(),
      installAddress: $("installAddress").value.trim(),
      changes: changes.map(c => ({ unit: c.unit.trim(), room: c.room.trim(), change: c.change.trim() })),
      previousPrice: previous,
      newPrice,
      changeAmount: newPrice - previous,
      outOfPocket,
      oopMethod: method,
      schedule,
      financeCode: selectedFinance[0] || "",
      financeLabel: selectedFinance[1] || "",
      financePlan: $("financePlan").value.trim(),
      signature1: !isCanvasBlank($("signature1")),
      signature2: $("customer2").value.trim() ? !isCanvasBlank($("signature2")) : false
    };
  }

  function renderReview(data) {
    const financeText = data.schedule.amountFinanced > 0
      ? `${escapeHtml(data.financeLabel)} (${escapeHtml(data.financeCode)}) - Application ID: ${escapeHtml(data.financePlan)}`
      : "No financing";
    const signatureText = [data.signature1 ? "Customer 1 signed" : "Customer 1 blank", data.customer2 ? (data.signature2 ? "Customer 2 signed" : "Customer 2 blank") : null].filter(Boolean).join("; ");

    $("reviewContent").innerHTML = `
      <div class="review-block">
        <h3>Order</h3>
        <ul class="review-list">
          <li><strong>Order #</strong><span>${escapeHtml(data.orderNumber)}</span></li>
          <li><strong>Contract Date</strong><span>${escapeHtml(dateForPdf(data.contractDate))}</span></li>
          <li><strong>Change Order Date</strong><span>${escapeHtml(data.changeOrderDate)}</span></li>
          <li><strong>Customer</strong><span>${escapeHtml(data.customer1)}${data.customer2 ? ` &amp; ${escapeHtml(data.customer2)}` : ""}</span></li>
          <li><strong>Installation Address</strong><span>${escapeHtml(data.installAddress)}</span></li>
          <li><strong>Design Consultant</strong><span>${escapeHtml(data.consultant)}</span></li>
        </ul>
      </div>
      <div class="review-block">
        <h3>${data.changes.length} Project Change${data.changes.length === 1 ? "" : "s"}</h3>
        ${data.changes.map((c, i) => `<div class="review-change"><strong>${i+1}. Unit ${escapeHtml(c.unit)} - ${escapeHtml(c.room)}</strong><br>${escapeHtml(c.change)}</div>`).join("")}
      </div>
      <div class="review-block">
        <h3>Pricing</h3>
        <ul class="review-list">
          <li><strong>Previous Project</strong><span class="review-money">${money(data.previousPrice)}</span></li>
          <li><strong>Change Order</strong><span class="review-money ${data.changeAmount > 0 ? "positive" : data.changeAmount < 0 ? "negative" : ""}">${money(data.changeAmount, true)}</span></li>
          <li><strong>New Project</strong><span class="review-money">${money(data.newPrice)}</span></li>
          <li><strong>Out of Pocket</strong><span>${data.outOfPocket > 0 ? `${money(data.outOfPocket)} by ${data.oopMethod === "check" ? "Check" : "Credit Card"}` : "Fully financed ($0.00 out of pocket)"}</span></li>
        </ul>
      </div>
      <div class="review-block">
        <h3>Finance &amp; Approval</h3>
        <ul class="review-list">
          <li><strong>Finance</strong><span>${financeText}</span></li>
          <li><strong>Signatures</strong><span>${escapeHtml(signatureText)}</span></li>
        </ul>
      </div>
    `;
  }

  function setupSignaturePad(canvas) {
    const ctx = canvas.getContext("2d");
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#111";
    let drawing = false;
    let last = null;

    const point = (e) => {
      const r = canvas.getBoundingClientRect();
      const p = e.touches ? e.touches[0] : e;
      return { x: (p.clientX - r.left) * (canvas.width / r.width), y: (p.clientY - r.top) * (canvas.height / r.height) };
    };
    const start = (e) => { e.preventDefault(); drawing = true; last = point(e); };
    const move = (e) => {
      if (!drawing) return;
      e.preventDefault();
      const p = point(e);
      ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke(); last = p;
    };
    const end = (e) => { if (drawing) e.preventDefault(); drawing = false; last = null; };

    canvas.addEventListener("pointerdown", start);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);
    canvas.addEventListener("pointerleave", end);
  }

  function clearCanvas(canvas) {
    canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
  }

  function isCanvasBlank(canvas) {
    const pixels = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
    for (let i = 3; i < pixels.length; i += 4) if (pixels[i] !== 0) return false;
    return true;
  }

  function signatureDataUrl(canvas) {
    return canvas.toDataURL("image/png");
  }

  function normalizePdfText(value) {
    return String(value ?? "")
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/[\u2013\u2014]/g, "-")
      .replace(/\u2026/g, "...")
      .replace(/[^\x20-\x7E\xA0-\xFF]/g, "");
  }

  function drawTextInBox(page, text, box, font, maxSize = 9, minSize = 4.5, padding = 3, align = "left") {
    const value = normalizePdfText(text);
    if (!value) return;
    const [x1, y1, x2, y2] = box;
    const width = x2 - x1;
    const height = y2 - y1;
    const available = Math.max(8, width - padding * 2);
    let size = maxSize;
    while (size > minSize && font.widthOfTextAtSize(value, size) > available) size -= 0.25;
    size = Math.max(minSize, size);
    const textWidth = font.widthOfTextAtSize(value, size);
    const textHeight = font.heightAtSize(size, { descender: false });
    let x = x1 + padding;
    if (align === "center") x = x1 + Math.max(padding, (width - textWidth) / 2);
    if (align === "right") x = x2 - padding - textWidth;
    const y = y1 + Math.max(1, (height - textHeight) / 2) + 0.5;
    page.drawText(value, { x, y, size, font });
  }

  function centsForPdf(cents, signed = false) {
    return money(cents, signed);
  }

  async function generatePdf(data) {
    if (!window.PDFLib) throw new Error("PDF library did not load. Check your internet connection and try again.");
    const { PDFDocument, StandardFonts } = window.PDFLib;
    const templateBytes = await fetch(TEMPLATE_PATH, { cache: "no-cache" }).then(r => {
      if (!r.ok) throw new Error("Unable to load the Change Order PDF template.");
      return r.arrayBuffer();
    });
    const pdfDoc = await PDFDocument.load(templateBytes);
    const page = pdfDoc.getPages()[0];
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

    drawTextInBox(page, dateForPdf(data.contractDate), PDF_BOXES.contractDate, font, 9);
    drawTextInBox(page, data.orderNumber, PDF_BOXES.orderNumber, font, 9);
    drawTextInBox(page, data.changeOrderDate, PDF_BOXES.changeOrderDate, font, 9);
    drawTextInBox(page, data.customer1, PDF_BOXES.customer1, font, 9);
    drawTextInBox(page, data.customer2, PDF_BOXES.customer2, font, 9);
    drawTextInBox(page, data.consultant, PDF_BOXES.consultant, font, 9);
    drawTextInBox(page, data.installAddress, PDF_BOXES.installAddress, font, 8.5);

    for (let i = 0; i < MAX_CHANGES; i++) {
      const row = PDF_BOXES.changeRows[i];
      const change = data.changes[i] || { unit: "", room: "", change: "" };
      drawTextInBox(page, change.unit, row.unit, font, 8.5, 4.5, 2);
      drawTextInBox(page, change.room, row.room, font, 8.5, 4.5, 2);
      drawTextInBox(page, change.change, row.change, font, 8.0, 4.25, 2);
    }

    const financeProgramText = data.schedule.amountFinanced > 0
      ? `${data.financeCode} - ${data.financeLabel.replace(" - ", " ")}`
      : "";
    drawTextInBox(page, financeProgramText, PDF_BOXES.financeProgram, font, 8, 4.5, 2);
    drawTextInBox(page, data.schedule.amountFinanced > 0 ? data.financePlan : "", PDF_BOXES.financePlan, font, 8, 4.5, 2);

    const s = data.schedule;
    drawTextInBox(page, centsForPdf(s.deposit.check), PDF_BOXES.depositCheck, font, 8, 5, 2, "center");
    drawTextInBox(page, centsForPdf(s.deposit.credit), PDF_BOXES.depositCredit, font, 8, 5, 2, "center");
    drawTextInBox(page, centsForPdf(s.deposit.finance), PDF_BOXES.depositFinance, font, 8, 5, 2, "center");
    drawTextInBox(page, centsForPdf(s.progress.check), PDF_BOXES.progressCheck, font, 8, 5, 2, "center");
    drawTextInBox(page, centsForPdf(s.progress.credit), PDF_BOXES.progressCredit, font, 8, 5, 2, "center");
    drawTextInBox(page, centsForPdf(s.progress.finance), PDF_BOXES.progressFinance, font, 8, 5, 2, "center");
    drawTextInBox(page, centsForPdf(s.installation.check), PDF_BOXES.installationCheck, font, 8, 5, 2, "center");
    drawTextInBox(page, centsForPdf(s.installation.credit), PDF_BOXES.installationCredit, font, 8, 5, 2, "center");
    drawTextInBox(page, centsForPdf(s.installation.finance), PDF_BOXES.installationFinance, font, 8, 5, 2, "center");

    drawTextInBox(page, centsForPdf(data.previousPrice), PDF_BOXES.previousPrice, font, 8.5, 5, 2, "center");
    drawTextInBox(page, centsForPdf(data.changeAmount, true), PDF_BOXES.changeAmount, font, 8.5, 5, 2, "center");
    drawTextInBox(page, centsForPdf(data.newPrice), PDF_BOXES.newPrice, font, 8.5, 5, 2, "center");

    const sig1Present = data.signature1;
    const sig2Present = data.signature2;
    drawTextInBox(page, sig1Present ? data.changeOrderDate : "", PDF_BOXES.customer1Date, font, 8.5, 5, 2);
    drawTextInBox(page, sig2Present ? data.changeOrderDate : "", PDF_BOXES.customer2Date, font, 8.5, 5, 2);
    // Management signature/date intentionally remain blank.

    if (sig1Present) {
      const png = await pdfDoc.embedPng(signatureDataUrl($("signature1")));
      const r = SIGNATURE_RECTS.signature1;
      const scale = Math.min(r.width / png.width, r.height / png.height);
      const w = png.width * scale, h = png.height * scale;
      page.drawImage(png, { x: r.x + (r.width - w)/2, y: r.y + (r.height - h)/2, width: w, height: h });
    }
    if (sig2Present) {
      const png = await pdfDoc.embedPng(signatureDataUrl($("signature2")));
      const r = SIGNATURE_RECTS.signature2;
      const scale = Math.min(r.width / png.width, r.height / png.height);
      const w = png.width * scale, h = png.height * scale;
      page.drawImage(png, { x: r.x + (r.width - w)/2, y: r.y + (r.height - h)/2, width: w, height: h });
    }

    return await pdfDoc.save({ updateFieldAppearances: false });
  }

  function safeFilenamePart(value) {
    return String(value || "").trim().replace(/[^a-zA-Z0-9 _-]+/g, "").replace(/\s+/g, " ").slice(0, 50) || "Customer";
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  async function handleGenerate() {
    if (isGenerating) return;
    isGenerating = true;
    const button = $("generateBtn");
    button.disabled = true;
    button.textContent = "Generating PDF...";
    $("saveStatus").textContent = "Generating...";
    try {
      const data = getFormData();
      const pdfBytes = await generatePdf(data);
      lastGeneratedBlob = new Blob([pdfBytes], { type: "application/pdf" });
      const customer = safeFilenamePart(data.customer1.split(/\s+/).slice(-1)[0] || data.customer1);
      const order = safeFilenamePart(data.orderNumber);
      lastGeneratedFilename = `Change Order - ${customer} - ${order}.pdf`;
      downloadBlob(lastGeneratedBlob, lastGeneratedFilename);
      reviewDialog.close();
      successDialog.showModal();
      $("saveStatus").textContent = "PDF created";
    } catch (err) {
      console.error(err);
      alert(err?.message || "Something went wrong while generating the PDF.");
      $("saveStatus").textContent = "Error";
    } finally {
      isGenerating = false;
      button.disabled = false;
      button.textContent = "Generate PDF";
    }
  }

  function resetForNewOrder() {
    const remembered = localStorage.getItem("changeorder_consultant") || "";
    const shouldRemember = !!remembered;
    formEl.reset();
    changes = [];
    addChange();
    clearCanvas($("signature1"));
    clearCanvas($("signature2"));
    $("changeOrderDate").value = todayForPdf();
    $("consultant").value = remembered;
    $("rememberConsultant").checked = shouldRemember;
    lastGeneratedBlob = null;
    formError.classList.add("hidden");
    successDialog.close();
    calculateLive();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function init() {
    $("changeOrderDate").value = todayForPdf();
    const savedConsultant = localStorage.getItem("changeorder_consultant");
    if (savedConsultant) {
      $("consultant").value = savedConsultant;
      $("rememberConsultant").checked = true;
    }

    setupSignaturePad($("signature1"));
    setupSignaturePad($("signature2"));
    addChange();
    calculateLive();

    $("addChangeBtn").addEventListener("click", () => addChange());
    changesList.addEventListener("input", (e) => syncChangeInput(e.target));
    changesList.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-remove-change]");
      if (btn) removeChange(btn.dataset.removeChange);
    });

    ["previousPrice", "newPrice", "outOfPocket", "customer2"].forEach(id => $(id).addEventListener("input", calculateLive));
    document.querySelectorAll('input[name="oopMethod"]').forEach(r => r.addEventListener("change", calculateLive));

    $("rememberConsultant").addEventListener("change", () => {
      if ($("rememberConsultant").checked && $("consultant").value.trim()) localStorage.setItem("changeorder_consultant", $("consultant").value.trim());
      else localStorage.removeItem("changeorder_consultant");
    });
    $("consultant").addEventListener("input", () => {
      if ($("rememberConsultant").checked) localStorage.setItem("changeorder_consultant", $("consultant").value.trim());
    });

    document.querySelectorAll("[data-clear-signature]").forEach(btn => btn.addEventListener("click", () => clearCanvas($(`signature${btn.dataset.clearSignature}`))));

    $("reviewBtn").addEventListener("click", () => {
      if (!validateForm()) return;
      const data = getFormData();
      renderReview(data);
      reviewDialog.showModal();
    });
    $("closeReviewBtn").addEventListener("click", () => reviewDialog.close());
    $("editBtn").addEventListener("click", () => reviewDialog.close());
    $("generateBtn").addEventListener("click", handleGenerate);
    $("downloadAgainBtn").addEventListener("click", () => { if (lastGeneratedBlob) downloadBlob(lastGeneratedBlob, lastGeneratedFilename); });
    $("newOrderBtn").addEventListener("click", resetForNewOrder);

    reviewDialog.addEventListener("click", e => { if (e.target === reviewDialog) reviewDialog.close(); });

    if ("serviceWorker" in navigator) {
      window.addEventListener("load", () => navigator.serviceWorker.register(`sw.js?v=${BUILD_VERSION}`, { scope: "./" }).catch(() => {}));
    }
  }

  init();
})();
