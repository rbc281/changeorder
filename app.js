(() => {
  "use strict";

  const BUILD_VERSION = "20260922v3";
  const TEMPLATE_IMAGE_PATH = `./change-order-template.png?v=${BUILD_VERSION}`;
  const MAX_CHANGES = 5;
  const MASTER_WIDTH = 2550;
  const MASTER_HEIGHT = 3300;
  const PDF_WIDTH = 612;
  const PDF_HEIGHT = 792;
  const CANVAS_SCALE = MASTER_WIDTH / PDF_WIDTH;
  const TODAY = new Date();

  // Coordinates are measured in PDF points on the original Letter-size form
  // and converted to the 300 DPI canvas at render time.
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
    customer2Date: [404, 139, 551, 153]
  };

  PDF_BOXES.changeRows = [
    [[47, 518, 105, 532], [107, 518, 227, 532], [230, 518, 543, 532]],
    [[48, 501, 105, 515], [107, 501, 226, 515], [230, 502, 542, 516]],
    [[47, 485, 104, 499], [107, 486, 227, 500], [230, 485, 542, 499]],
    [[47, 468, 105, 482], [108, 470, 227, 484], [229, 469, 542, 483]],
    [[48, 453, 104, 467], [107, 452, 226, 466], [229, 452, 542, 466]]
  ].map(([unit, room, change]) => ({ unit, room, change }));

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
  const previewDialog = $("previewDialog");
  const previewCanvas = $("changeOrderPreview");
  const previewViewport = $("previewViewport");
  const formError = $("formError");

  let changes = [];
  let templateImagePromise = null;
  let renderedData = null;
  let previewScale = 1;
  let isRendering = false;
  let isDownloading = false;

  function pad2(n) { return String(n).padStart(2, "0"); }

  function dateForPdf(inputValue) {
    if (!inputValue) return "";
    const [year, month, day] = inputValue.split("-");
    return `${month}/${day}/${year}`;
  }

  function todayForPdf() {
    return `${pad2(TODAY.getMonth() + 1)}/${pad2(TODAY.getDate())}/${TODAY.getFullYear()}`;
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
    }[character]));
  }

  function parseMoneyToCents(value) {
    let raw = String(value || "").trim();
    if (raw === "") return 0;
    raw = raw.replace(/[$,\s]/g, "");
    if (raw === "" || raw === "." || raw === "-") return 0;
    const negative = raw.startsWith("-");
    if (negative) raw = raw.slice(1);
    const parts = raw.split(".");
    const whole = (parts[0] || "0").replace(/[^\d]/g, "");
    const decimal = (parts[1] || "").replace(/[^\d]/g, "");
    const total = parseInt(whole || "0", 10) * 100 + parseInt((decimal + "00").slice(0, 2), 10);
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

  // Preserve the current PAF rules: deposit <= min(10%, $1,000), 33% due
  // through progress, remainder at installation, out-of-pocket allocated first.
  function calculatePaymentSchedule(projectTotal, outOfPocket, method) {
    projectTotal = Math.max(0, Math.trunc(projectTotal || 0));
    outOfPocket = Math.max(0, Math.min(Math.trunc(outOfPocket || 0), projectTotal));
    const amountFinanced = projectTotal - outOfPocket;
    const payment1 = outOfPocket > 0 ? Math.min(outOfPocket, Math.min(Math.trunc(projectTotal * 10 / 100), 100000)) : 0;
    const payment2 = Math.max(Math.trunc(projectTotal * 33 / 100) - payment1, 0);
    const payment3 = projectTotal - payment1 - payment2;
    let remainingOop = outOfPocket;
    const oop1 = Math.min(remainingOop, payment1); remainingOop -= oop1;
    const oop2 = Math.min(remainingOop, payment2); remainingOop -= oop2;
    const oop3 = Math.min(remainingOop, payment3);
    const allocation = (oop, finance, total) => ({
      check: method === "check" ? oop : 0,
      credit: method === "credit" ? oop : 0,
      finance,
      total
    });
    return {
      amountFinanced,
      deposit: allocation(oop1, payment1 - oop1, payment1),
      progress: allocation(oop2, payment2 - oop2, payment2),
      installation: allocation(oop3, payment3 - oop3, payment3)
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
          <div><label>Unit # <span class="req">Required</span></label><input data-change-field="unit" maxlength="12" value="${escapeHtml(item.unit)}" placeholder="e.g. 3" required /></div>
          <div><label>Room / Description <span class="req">Required</span></label><input data-change-field="room" maxlength="32" value="${escapeHtml(item.room)}" placeholder="e.g. Living Room" required /></div>
          <div class="change-description">
            <label>What is changing? <span class="req">Required</span></label>
            <input data-change-field="change" maxlength="110" value="${escapeHtml(item.change)}" placeholder="Describe the revision" required />
            <div class="char-count"><span>${item.change.length}</span>/110</div>
          </div>
        </div>
      </div>
    `).join("");
    $("addChangeBtn").disabled = changes.length >= MAX_CHANGES;
    $("addChangeBtn").textContent = changes.length >= MAX_CHANGES ? "Maximum of 5 Changes Reached" : "+ Add Another Change";
  }

  function syncChangeInput(target) {
    const itemEl = target.closest(".change-item");
    if (!itemEl) return;
    const item = changes.find((change) => change.id === itemEl.dataset.changeId);
    if (!item) return;
    const field = target.dataset.changeField;
    if (field) item[field] = target.value;
    const count = itemEl.querySelector(".char-count span");
    if (count && field === "change") count.textContent = target.value.length;
  }

  function removeChange(id) {
    if (changes.length <= 1) return;
    changes = changes.filter((change) => change.id !== id);
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
    const financingNeeded = projectTotal > 0 && outOfPocket < projectTotal;
    financeFields.classList.toggle("hidden", !financingNeeded);
    $("financeProgram").required = financingNeeded;
    const oopMethodNeeded = outOfPocket > 0;
    oopMethodWrap.classList.toggle("hidden", !oopMethodNeeded);
    document.querySelectorAll('input[name="oopMethod"]').forEach((radio) => { radio.required = oopMethodNeeded; });
    const calc = calculatePaymentSchedule(projectTotal, outOfPocket, method);
    [["dep", calc.deposit], ["prog", calc.progress], ["inst", calc.installation]].forEach(([prefix, row]) => {
      $(`${prefix}Check`).textContent = money(row.check);
      $(`${prefix}Credit`).textContent = money(row.credit);
      $(`${prefix}Finance`).textContent = money(row.finance);
      $(`${prefix}Total`).textContent = money(row.total);
    });
    $("financeSummary").textContent = `Amount financed: ${money(calc.amountFinanced)}`;
    $("signature2Card").classList.toggle("hidden", !$("customer2").value.trim());
  }

  function markInvalid(element, invalid) {
    if (element) element.classList.toggle("invalid", Boolean(invalid));
  }

  function validateForm() {
    document.querySelectorAll(".invalid").forEach((element) => element.classList.remove("invalid"));
    formError.classList.add("hidden");
    const errors = [];
    ["contractDate", "orderNumber", "consultant", "customer1", "installAddress", "previousPrice", "newPrice"].forEach((id) => {
      const element = $(id);
      if (!String(element.value || "").trim()) {
        markInvalid(element, true);
        errors.push(`${element.closest(".field")?.querySelector("label")?.childNodes[0]?.textContent?.trim() || id} is required.`);
      }
    });
    changes.forEach((change, index) => {
      const itemEl = changesList.querySelector(`[data-change-id="${change.id}"]`);
      ["unit", "room", "change"].forEach((field) => {
        if (!String(change[field] || "").trim()) {
          markInvalid(itemEl?.querySelector(`[data-change-field="${field}"]`), true);
          errors.push(`Change #${index + 1} is incomplete.`);
        }
      });
    });
    const previous = parseMoneyToCents($("previousPrice").value);
    const newPrice = parseMoneyToCents($("newPrice").value);
    const outOfPocket = parseMoneyToCents($("outOfPocket").value);
    if (previous <= 0) { markInvalid($("previousPrice"), true); errors.push("Previous Project Price must be greater than $0."); }
    if (newPrice <= 0) { markInvalid($("newPrice"), true); errors.push("New Project Price must be greater than $0."); }
    if (outOfPocket < 0) { markInvalid($("outOfPocket"), true); errors.push("Out-of-pocket amount cannot be negative."); }
    if (newPrice > 0 && outOfPocket > newPrice) { markInvalid($("outOfPocket"), true); errors.push("Out-of-pocket amount cannot exceed the New Project Price."); }
    if (outOfPocket > 0 && !selectedOopMethod()) errors.push("Select Check or Credit Card for the out-of-pocket payment method.");
    if (newPrice > 0 && outOfPocket < newPrice && !$("financeProgram").value) {
      markInvalid($("financeProgram"), true);
      errors.push("Finance Program is required when financing is used.");
    }
    if (errors.length) {
      const unique = [...new Set(errors)];
      formError.textContent = unique[0] + (unique.length > 1 ? ` Plus ${unique.length - 1} more item${unique.length > 2 ? "s" : ""} to complete.` : "");
      formError.classList.remove("hidden");
      (document.querySelector(".invalid") || formError).scrollIntoView({ behavior: "smooth", block: "center" });
      return false;
    }
    return true;
  }

  function getFormData() {
    const previous = parseMoneyToCents($("previousPrice").value);
    const newPrice = parseMoneyToCents($("newPrice").value);
    const outOfPocket = parseMoneyToCents($("outOfPocket").value);
    const method = selectedOopMethod();
    const selectedFinance = $("financeProgram").value ? $("financeProgram").value.split("|") : ["", ""];
    return {
      contractDate: $("contractDate").value,
      orderNumber: $("orderNumber").value.trim(),
      changeOrderDate: todayForPdf(),
      consultant: $("consultant").value.trim(),
      customer1: $("customer1").value.trim(),
      customer2: $("customer2").value.trim(),
      installAddress: $("installAddress").value.trim(),
      changes: changes.map((change) => ({ unit: change.unit.trim(), room: change.room.trim(), change: change.change.trim() })),
      previousPrice: previous,
      newPrice,
      changeAmount: newPrice - previous,
      outOfPocket,
      oopMethod: method,
      schedule: calculatePaymentSchedule(newPrice, outOfPocket, method),
      financeCode: selectedFinance[0] || "",
      financeLabel: selectedFinance[1] || "",
      signature1: !isCanvasBlank($("signature1")),
      signature2: $("customer2").value.trim() ? !isCanvasBlank($("signature2")) : false
    };
  }

  function renderReview(data) {
    const financeText = data.schedule.amountFinanced > 0
      ? `${escapeHtml(data.financeLabel)} (Finance Plan # ${escapeHtml(data.financeCode)})`
      : "No financing";
    const signatureText = [
      data.signature1 ? "Customer 1 signed" : "Customer 1 blank - DocuSign",
      data.customer2 ? (data.signature2 ? "Customer 2 signed" : "Customer 2 blank - DocuSign") : null
    ].filter(Boolean).join("; ");
    $("reviewContent").innerHTML = `
      <div class="review-block"><h3>Order</h3><ul class="review-list">
        <li><strong>Order #</strong><span>${escapeHtml(data.orderNumber)}</span></li>
        <li><strong>Contract Date</strong><span>${escapeHtml(dateForPdf(data.contractDate))}</span></li>
        <li><strong>Change Order Date</strong><span>${escapeHtml(data.changeOrderDate)}</span></li>
        <li><strong>Customer</strong><span>${escapeHtml(data.customer1)}${data.customer2 ? ` &amp; ${escapeHtml(data.customer2)}` : ""}</span></li>
        <li><strong>Installation Address</strong><span>${escapeHtml(data.installAddress)}</span></li>
        <li><strong>Design Consultant</strong><span>${escapeHtml(data.consultant)}</span></li>
      </ul></div>
      <div class="review-block"><h3>${data.changes.length} Project Change${data.changes.length === 1 ? "" : "s"}</h3>
        ${data.changes.map((change, index) => `<div class="review-change"><strong>${index + 1}. Unit ${escapeHtml(change.unit)} - ${escapeHtml(change.room)}</strong><br>${escapeHtml(change.change)}</div>`).join("")}
      </div>
      <div class="review-block"><h3>Pricing</h3><ul class="review-list">
        <li><strong>Previous Project</strong><span class="review-money">${money(data.previousPrice)}</span></li>
        <li><strong>Change Order</strong><span class="review-money ${data.changeAmount > 0 ? "positive" : data.changeAmount < 0 ? "negative" : ""}">${money(data.changeAmount, true)}</span></li>
        <li><strong>New Project</strong><span class="review-money">${money(data.newPrice)}</span></li>
        <li><strong>Out of Pocket</strong><span>${data.outOfPocket > 0 ? `${money(data.outOfPocket)} by ${data.oopMethod === "check" ? "Check" : "Credit Card"}` : "Fully financed ($0.00 out of pocket)"}</span></li>
      </ul></div>
      <div class="review-block"><h3>Finance &amp; Approval</h3><ul class="review-list">
        <li><strong>Finance</strong><span>${financeText}</span></li>
        <li><strong>Signatures</strong><span>${escapeHtml(signatureText)}</span></li>
      </ul></div>`;
  }

  function setupSignaturePad(canvas) {
    const context = canvas.getContext("2d");
    context.lineWidth = 5;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.strokeStyle = "#111";
    let drawing = false;
    let last = null;
    const point = (event) => {
      const rect = canvas.getBoundingClientRect();
      return { x: (event.clientX - rect.left) * (canvas.width / rect.width), y: (event.clientY - rect.top) * (canvas.height / rect.height) };
    };
    canvas.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      canvas.setPointerCapture?.(event.pointerId);
      drawing = true;
      last = point(event);
    });
    canvas.addEventListener("pointermove", (event) => {
      if (!drawing) return;
      event.preventDefault();
      const next = point(event);
      context.beginPath(); context.moveTo(last.x, last.y); context.lineTo(next.x, next.y); context.stroke(); last = next;
    });
    const finish = () => { drawing = false; last = null; };
    canvas.addEventListener("pointerup", finish);
    canvas.addEventListener("pointercancel", finish);
    canvas.addEventListener("pointerleave", finish);
  }

  function clearCanvas(canvas) { canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height); }

  function isCanvasBlank(canvas) {
    const pixels = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
    for (let index = 3; index < pixels.length; index += 4) if (pixels[index] !== 0) return false;
    return true;
  }

  function normalizeCanvasText(value) {
    return String(value ?? "").replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/[\u2013\u2014]/g, "-").replace(/\u2026/g, "...");
  }

  function canvasRectFromPdfBox([x1, y1, x2, y2]) {
    return { x: x1 * CANVAS_SCALE, y: (PDF_HEIGHT - y2) * CANVAS_SCALE, width: (x2 - x1) * CANVAS_SCALE, height: (y2 - y1) * CANVAS_SCALE };
  }

  function drawTextInBox(context, text, pdfBox, maxSize = 9, minSize = 4.5, padding = 3, align = "left") {
    const value = normalizeCanvasText(text);
    if (!value) return;
    const rect = canvasRectFromPdfBox(pdfBox);
    const horizontalPadding = padding * CANVAS_SCALE;
    const available = Math.max(8, rect.width - horizontalPadding * 2);
    let fontSize = maxSize * CANVAS_SCALE;
    const minimumFontSize = minSize * CANVAS_SCALE;
    context.fillStyle = "#000";
    context.textBaseline = "middle";
    context.textAlign = align;
    while (fontSize > minimumFontSize) {
      context.font = `${fontSize}px Arial, Helvetica, sans-serif`;
      if (context.measureText(value).width <= available) break;
      fontSize -= 1;
    }
    context.font = `${Math.max(minimumFontSize, fontSize)}px Arial, Helvetica, sans-serif`;
    let x = rect.x + horizontalPadding;
    if (align === "center") x = rect.x + rect.width / 2;
    if (align === "right") x = rect.x + rect.width - horizontalPadding;
    context.fillText(value, x, rect.y + rect.height / 2 + CANVAS_SCALE * 0.35, available);
  }

  function drawSignature(context, sourceCanvas, pdfRect) {
    context.drawImage(
      sourceCanvas,
      pdfRect.x * CANVAS_SCALE,
      (PDF_HEIGHT - pdfRect.y - pdfRect.height) * CANVAS_SCALE,
      pdfRect.width * CANVAS_SCALE,
      pdfRect.height * CANVAS_SCALE
    );
  }

  function drawPolicyNotice(context) {
    const left = 42 * CANVAS_SCALE;
    const top = (PDF_HEIGHT - 258) * CANVAS_SCALE;
    const width = 330 * CANVAS_SCALE;
    const height = 15 * CANVAS_SCALE;
    context.fillStyle = "#fff";
    context.fillRect(left, top, width, height);
    context.fillStyle = "#000";
    context.font = `${6.5 * CANVAS_SCALE}px Arial, Helvetica, sans-serif`;
    context.textAlign = "left";
    context.textBaseline = "middle";
    context.fillText(
      "More than 5 line items or a 10% change in price requires a new contract change order.",
      left,
      top + height / 2,
      width
    );
  }

  function loadTemplateImage() {
    if (!templateImagePromise) {
      templateImagePromise = new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("Unable to load the Change Order image template."));
        image.src = TEMPLATE_IMAGE_PATH;
      });
    }
    return templateImagePromise;
  }

  async function renderChangeOrder(data) {
    const templateImage = await loadTemplateImage();
    const context = previewCanvas.getContext("2d", { alpha: false });
    context.save();
    context.clearRect(0, 0, MASTER_WIDTH, MASTER_HEIGHT);
    context.drawImage(templateImage, 0, 0, MASTER_WIDTH, MASTER_HEIGHT);
    drawPolicyNotice(context);
    drawTextInBox(context, dateForPdf(data.contractDate), PDF_BOXES.contractDate, 9);
    drawTextInBox(context, data.orderNumber, PDF_BOXES.orderNumber, 9);
    drawTextInBox(context, data.changeOrderDate, PDF_BOXES.changeOrderDate, 9);
    drawTextInBox(context, data.customer1, PDF_BOXES.customer1, 9);
    drawTextInBox(context, data.customer2, PDF_BOXES.customer2, 9);
    drawTextInBox(context, data.consultant, PDF_BOXES.consultant, 9);
    drawTextInBox(context, data.installAddress, PDF_BOXES.installAddress, 8.5);
    for (let index = 0; index < MAX_CHANGES; index += 1) {
      const row = PDF_BOXES.changeRows[index];
      const change = data.changes[index] || { unit: "", room: "", change: "" };
      drawTextInBox(context, change.unit, row.unit, 8.5, 4.5, 2);
      drawTextInBox(context, change.room, row.room, 8.5, 4.5, 2);
      drawTextInBox(context, change.change, row.change, 8, 4.25, 2);
    }
    const hasFinancing = data.schedule.amountFinanced > 0;
    drawTextInBox(context, hasFinancing ? data.financeLabel : "", PDF_BOXES.financeProgram, 8, 4.5, 2);
    drawTextInBox(context, hasFinancing ? data.financeCode : "", PDF_BOXES.financePlan, 8, 4.5, 2);
    const schedule = data.schedule;
    drawTextInBox(context, money(schedule.deposit.check), PDF_BOXES.depositCheck, 8, 5, 2, "center");
    drawTextInBox(context, money(schedule.deposit.credit), PDF_BOXES.depositCredit, 8, 5, 2, "center");
    drawTextInBox(context, money(schedule.deposit.finance), PDF_BOXES.depositFinance, 8, 5, 2, "center");
    drawTextInBox(context, money(schedule.progress.check), PDF_BOXES.progressCheck, 8, 5, 2, "center");
    drawTextInBox(context, money(schedule.progress.credit), PDF_BOXES.progressCredit, 8, 5, 2, "center");
    drawTextInBox(context, money(schedule.progress.finance), PDF_BOXES.progressFinance, 8, 5, 2, "center");
    drawTextInBox(context, money(schedule.installation.check), PDF_BOXES.installationCheck, 8, 5, 2, "center");
    drawTextInBox(context, money(schedule.installation.credit), PDF_BOXES.installationCredit, 8, 5, 2, "center");
    drawTextInBox(context, money(schedule.installation.finance), PDF_BOXES.installationFinance, 8, 5, 2, "center");
    drawTextInBox(context, money(data.previousPrice), PDF_BOXES.previousPrice, 8.5, 5, 2, "center");
    drawTextInBox(context, money(data.changeAmount, true), PDF_BOXES.changeAmount, 8.5, 5, 2, "center");
    drawTextInBox(context, money(data.newPrice), PDF_BOXES.newPrice, 8.5, 5, 2, "center");
    if (data.signature1) {
      drawSignature(context, $("signature1"), SIGNATURE_RECTS.signature1);
      drawTextInBox(context, data.changeOrderDate, PDF_BOXES.customer1Date, 8.5, 5, 2);
    }
    if (data.signature2) {
      drawSignature(context, $("signature2"), SIGNATURE_RECTS.signature2);
      drawTextInBox(context, data.changeOrderDate, PDF_BOXES.customer2Date, 8.5, 5, 2);
    }
    // Management signature and date intentionally remain blank.
    context.restore();
    renderedData = data;
  }

  function setPreviewScale(scale, label) {
    previewScale = Math.max(0.1, Math.min(1, scale));
    previewCanvas.style.width = `${Math.round(MASTER_WIDTH * previewScale)}px`;
    previewCanvas.style.height = `${Math.round(MASTER_HEIGHT * previewScale)}px`;
    $("zoomLabel").textContent = label || `${Math.round(previewScale * 100)}%`;
  }

  function fitPreview() {
    const availableWidth = Math.max(280, previewViewport.clientWidth - 28);
    setPreviewScale(Math.min(1, availableWidth / MASTER_WIDTH), "Fit");
    previewViewport.scrollTo({ top: 0, left: 0 });
  }

  async function openPreview() {
    if (isRendering) return;
    isRendering = true;
    const button = $("viewBtn");
    button.disabled = true;
    button.textContent = "Rendering...";
    $("saveStatus").textContent = "Rendering...";
    try {
      await renderChangeOrder(getFormData());
      reviewDialog.close();
      previewDialog.showModal();
      requestAnimationFrame(fitPreview);
      $("saveStatus").textContent = "Preview ready";
    } catch (error) {
      console.error(error);
      alert(error?.message || "Something went wrong while rendering the Change Order.");
      $("saveStatus").textContent = "Error";
    } finally {
      isRendering = false;
      button.disabled = false;
      button.textContent = "View Change Order";
    }
  }

  function safeFilenamePart(value) {
    return String(value || "").trim().replace(/[^a-zA-Z0-9 _-]+/g, "").replace(/\s+/g, " ").slice(0, 50) || "Customer";
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  async function downloadPdf() {
    if (isDownloading || !renderedData) return;
    if (!window.PDFLib) { alert("PDF library did not load. Check your internet connection and try again."); return; }
    isDownloading = true;
    const button = $("downloadPdfBtn");
    button.disabled = true;
    button.textContent = "Creating PDF...";
    $("saveStatus").textContent = "Creating PDF...";
    try {
      const { PDFDocument } = window.PDFLib;
      const pdfDocument = await PDFDocument.create();
      pdfDocument.setTitle(`Change Order - ${renderedData.customer1}`);
      pdfDocument.setCreator("Renewal by Andersen GLA Change Order Generator V3");
      const page = pdfDocument.addPage([PDF_WIDTH, PDF_HEIGHT]);
      const renderedImage = await pdfDocument.embedPng(previewCanvas.toDataURL("image/png"));
      page.drawImage(renderedImage, { x: 0, y: 0, width: PDF_WIDTH, height: PDF_HEIGHT });
      const pdfBytes = await pdfDocument.save({ useObjectStreams: true });
      const customer = safeFilenamePart(renderedData.customer1.split(/\s+/).slice(-1)[0] || renderedData.customer1);
      const order = safeFilenamePart(renderedData.orderNumber);
      downloadBlob(new Blob([pdfBytes], { type: "application/pdf" }), `Change Order - ${customer} - ${order}.pdf`);
      $("saveStatus").textContent = "PDF downloaded";
    } catch (error) {
      console.error(error);
      alert(error?.message || "Something went wrong while creating the PDF.");
      $("saveStatus").textContent = "Error";
    } finally {
      isDownloading = false;
      button.disabled = false;
      button.textContent = "Download PDF";
    }
  }

  function clearAllData() {
    if (!window.confirm("Clear all entered Change Order data? This cannot be undone.")) return;
    formEl.reset();
    localStorage.removeItem("changeorder_consultant");
    changes = [];
    addChange();
    clearCanvas($("signature1"));
    clearCanvas($("signature2"));
    $("changeOrderDate").value = todayForPdf();
    formError.classList.add("hidden");
    renderedData = null;
    if (reviewDialog.open) reviewDialog.close();
    if (previewDialog.open) previewDialog.close();
    calculateLive();
    $("saveStatus").textContent = "Ready";
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function init() {
    $("changeOrderDate").value = todayForPdf();
    const savedConsultant = localStorage.getItem("changeorder_consultant");
    if (savedConsultant) { $("consultant").value = savedConsultant; $("rememberConsultant").checked = true; }
    setupSignaturePad($("signature1"));
    setupSignaturePad($("signature2"));
    addChange();
    calculateLive();
    loadTemplateImage().catch(() => {});
    $("addChangeBtn").addEventListener("click", () => addChange());
    changesList.addEventListener("input", (event) => syncChangeInput(event.target));
    changesList.addEventListener("click", (event) => {
      const button = event.target.closest("[data-remove-change]");
      if (button) removeChange(button.dataset.removeChange);
    });
    ["previousPrice", "newPrice", "outOfPocket", "customer2"].forEach((id) => $(id).addEventListener("input", calculateLive));
    document.querySelectorAll('input[name="oopMethod"]').forEach((radio) => radio.addEventListener("change", calculateLive));
    $("rememberConsultant").addEventListener("change", () => {
      if ($("rememberConsultant").checked && $("consultant").value.trim()) localStorage.setItem("changeorder_consultant", $("consultant").value.trim());
      else localStorage.removeItem("changeorder_consultant");
    });
    $("consultant").addEventListener("input", () => {
      if ($("rememberConsultant").checked) localStorage.setItem("changeorder_consultant", $("consultant").value.trim());
    });
    document.querySelectorAll("[data-clear-signature]").forEach((button) => {
      button.addEventListener("click", () => clearCanvas($(`signature${button.dataset.clearSignature}`)));
    });
    $("reviewBtn").addEventListener("click", () => {
      if (!validateForm()) return;
      renderReview(getFormData());
      reviewDialog.showModal();
    });
    $("closeReviewBtn").addEventListener("click", () => reviewDialog.close());
    $("editBtn").addEventListener("click", () => reviewDialog.close());
    $("viewBtn").addEventListener("click", openPreview);
    $("closePreviewBtn").addEventListener("click", () => previewDialog.close());
    $("backToReviewBtn").addEventListener("click", () => { previewDialog.close(); reviewDialog.showModal(); });
    $("downloadPdfBtn").addEventListener("click", downloadPdf);
    $("fitPreviewBtn").addEventListener("click", fitPreview);
    $("zoomInBtn").addEventListener("click", () => setPreviewScale(previewScale * 1.25));
    $("zoomOutBtn").addEventListener("click", () => setPreviewScale(previewScale / 1.25));
    $("clearTopBtn").addEventListener("click", clearAllData);
    $("clearBottomBtn").addEventListener("click", clearAllData);
    reviewDialog.addEventListener("click", (event) => { if (event.target === reviewDialog) reviewDialog.close(); });
    previewDialog.addEventListener("click", (event) => { if (event.target === previewDialog) previewDialog.close(); });
    if ("serviceWorker" in navigator) {
      window.addEventListener("load", () => navigator.serviceWorker.register(`sw.js?v=${BUILD_VERSION}`, { scope: "./" }).catch(() => {}));
    }
  }

  init();
})();
