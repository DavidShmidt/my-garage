const STORAGE_KEY = "my-garage-v1";
const SYNC_SETTINGS_KEY = "my-garage-sync-v1";

const defaultCars = [
  {
    id: "vaz-2115",
    name: "ВАЗ-2115",
    meta: "2006 год",
    year: 2006,
    plate: "",
    vin: "",
    status: "На ходу",
    note: "",
    mileage: 315000,
    photo: "",
    records: [
      { id: crypto.randomUUID(), date: "2024-05-15", mileage: 312000, work: "Замена масла и масляного фильтра", cost: 1800, comment: "Лукойл 10W-40" },
      { id: crypto.randomUUID(), date: "2024-02-02", mileage: 304500, work: "Регулировка клапанов", cost: 2000, comment: "Холодная регулировка" },
      { id: crypto.randomUUID(), date: "2023-10-21", mileage: 298000, work: "Проверка лямбда-зонда", cost: 1200, comment: "Показания в норме" }
    ]
  },
  { id: "polo-sedan", name: "VW Polo Sedan", meta: "5 поколение", year: "", plate: "", vin: "", status: "На ходу", note: "", mileage: 0, photo: "", records: [] },
  { id: "renault-sandero", name: "Renault Sandero", meta: "Личный автомобиль", year: "", plate: "", vin: "", status: "На ходу", note: "", mileage: 0, photo: "", records: [] },
  { id: "lada-largus", name: "Lada Largus", meta: "Личный автомобиль", year: "", plate: "", vin: "", status: "На ходу", note: "", mileage: 0, photo: "", records: [] }
];

function loadCars() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (Array.isArray(saved) && saved.length === defaultCars.length) {
      return saved.map((car, index) => ({ ...defaultCars[index], ...car }));
    }
  } catch {}
  return structuredClone(defaultCars);
}

let cars = loadCars();
let activeId = location.hash.replace("#", "") || cars[0].id;
if (!cars.some((car) => car.id === activeId)) activeId = cars[0].id;
let syncTimer = null;
let pullTimer = null;
let lastPullAt = 0;
let isPullingFromSheets = false;
let hasLoadedFromSheets = false;
let syncStatusMessage = "";
let syncSettings = loadSyncSettings();

const $ = (selector) => document.querySelector(selector);
const elements = {
  nav: $("#carNav"),
  title: $("#carTitle"),
  subtitle: $("#carSubtitle"),
  heroName: $("#heroName"),
  mileage: $("#mileageValue"),
  count: $("#recordsCount"),
  lastService: $("#lastService"),
  photo: $("#carPhoto"),
  photoInput: $("#photoInput"),
  records: $("#recordsList"),
  empty: $("#emptyState"),
  recordDialog: $("#recordDialog"),
  recordForm: $("#recordForm"),
  mileageDialog: $("#mileageDialog"),
  mileageForm: $("#mileageForm"),
  carDialog: $("#carDialog"),
  carForm: $("#carForm"),
  syncDialog: $("#syncDialog"),
  syncForm: $("#syncForm"),
  syncTitle: $("#syncTitle"),
  syncText: $("#syncText")
};

const activeCar = () => cars.find((car) => car.id === activeId);
const formatMileage = (value) => new Intl.NumberFormat("ru-RU").format(Number(value) || 0);
const formatCost = (value) => value === "" || value === null || value === undefined
  ? "—"
  : `${new Intl.NumberFormat("ru-RU").format(Number(value) || 0)} ₽`;
const formatDate = (value) => new Intl.DateTimeFormat("ru-RU").format(new Date(`${value}T12:00:00`));
const sortRecords = (records) => records.sort((a, b) =>
  b.date.localeCompare(a.date) || Number(b.mileage) - Number(a.mileage)
);

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cars));
    if (!isPullingFromSheets) schedulePushToSheets();
    return true;
  } catch {
    alert("Не удалось сохранить данные. Возможно, хранилище браузера заполнено.");
    return false;
  }
}

function loadSyncSettings() {
  const defaults = window.GARAGE_CONFIG || {};
  try {
    const saved = JSON.parse(localStorage.getItem(SYNC_SETTINGS_KEY)) || {};
    return {
      googleScriptUrl: saved.googleScriptUrl || defaults.googleScriptUrl || "",
      syncPin: saved.syncPin || defaults.syncPin || ""
    };
  } catch {
    return {
      googleScriptUrl: defaults.googleScriptUrl || "",
      syncPin: defaults.syncPin || ""
    };
  }
}

function saveSyncSettings() {
  localStorage.setItem(SYNC_SETTINGS_KEY, JSON.stringify(syncSettings));
  updateSyncStatus();
}

function isSyncEnabled() {
  return Boolean(syncSettings.googleScriptUrl && syncSettings.syncPin);
}

function updateSyncStatus(text) {
  if (!elements.syncTitle || !elements.syncText) return;
  if (text) syncStatusMessage = text;
  elements.syncTitle.textContent = isSyncEnabled() ? "Google Таблица" : "Локальный режим";
  elements.syncText.textContent = syncStatusMessage || (isSyncEnabled() ? "Синхронизация включена" : "Google Таблица не подключена");
  const refreshButton = $("#refreshFromSheets");
  if (refreshButton) refreshButton.disabled = !isSyncEnabled();
}

function schedulePushToSheets() {
  if (!isSyncEnabled()) {
    updateSyncStatus();
    return;
  }
  if (!hasLoadedFromSheets) {
    updateSyncStatus("Сначала загрузите данные из таблицы");
    return;
  }
  clearTimeout(syncTimer);
  syncTimer = setTimeout(pushToSheets, 650);
}

function pushToSheets() {
  if (!isSyncEnabled()) return;
  if (!hasLoadedFromSheets) {
    updateSyncStatus("Сначала загрузите данные из таблицы");
    return;
  }
  updateSyncStatus("Отправка данных...");
  const formData = new FormData();
  formData.set("pin", syncSettings.syncPin);
  formData.set("payload", JSON.stringify({ cars }));
  fetch(syncSettings.googleScriptUrl, {
    method: "POST",
    mode: "no-cors",
    body: formData
  }).then(() => {
    updateSyncStatus("Отправлено в таблицу");
  }).catch(() => {
    updateSyncStatus("Не удалось отправить");
  });
}

function pullFromSheets(options = {}) {
  if (!isSyncEnabled()) {
    if (!options.silent) alert("Сначала укажите URL Apps Script и PIN.");
    return;
  }
  if (Date.now() - lastPullAt < 12000 && options.silent) return;

  updateSyncStatus("Загрузка из таблицы...");
  const callbackName = `garageSheets_${Date.now()}`;
  const url = new URL(syncSettings.googleScriptUrl);
  url.searchParams.set("action", "load");
  url.searchParams.set("pin", syncSettings.syncPin);
  url.searchParams.set("callback", callbackName);

  window[callbackName] = (response) => {
    delete window[callbackName];
    script.remove();
    if (!response?.ok || !Array.isArray(response.cars)) {
      updateSyncStatus("Ошибка загрузки");
      if (!options.silent) alert("Не удалось загрузить данные из Google Таблицы.");
      return;
    }
    cars = response.cars.map((car, index) => ({ ...(defaultCars[index] || defaultCars[0]), ...car }));
    if (!cars.some((car) => car.id === activeId)) activeId = cars[0]?.id || defaultCars[0].id;
    isPullingFromSheets = true;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cars));
    lastPullAt = Date.now();
    hasLoadedFromSheets = true;
    isPullingFromSheets = false;
    updateSyncStatus(`Загружено: ${new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`);
    elements.syncDialog.close();
    render();
  };

  const script = document.createElement("script");
  script.src = url.toString();
  script.onerror = () => {
    delete window[callbackName];
    script.remove();
    updateSyncStatus("Ошибка загрузки");
    if (!options.silent) alert("Не удалось подключиться к Apps Script.");
  };
  document.head.appendChild(script);
}

function startAutoPull() {
  clearInterval(pullTimer);
  if (!isSyncEnabled()) return;
  setTimeout(() => pullFromSheets({ silent: true }), 900);
  pullTimer = setInterval(() => pullFromSheets({ silent: true }), 30000);
}

function renderNav() {
  elements.nav.innerHTML = cars.map((car) => `
    <button class="car-nav-item ${car.id === activeId ? "active" : ""}" data-car-id="${car.id}">
      <span class="car-nav-icon"><svg><use href="#i-car"></use></svg></span>
      <span><strong>${escapeHtml(car.name)}</strong><small>${car.year ? `${car.year} год` : car.meta}</small></span>
    </button>
  `).join("");
}

function renderRecords(car) {
  const records = sortRecords([...car.records]);
  elements.records.innerHTML = records.map((record) => `
    <article class="record">
      <div class="record-cell"><small>ДАТА</small><strong>${formatDate(record.date)}</strong></div>
      <div class="record-cell"><small>ПРОБЕГ</small><strong>${formatMileage(record.mileage)} км</strong></div>
      <div class="record-cell record-work"><small>ВЫПОЛНЕННАЯ РАБОТА</small><strong>${escapeHtml(record.work)}</strong></div>
      <div class="record-cell record-cost"><small>СТОИМОСТЬ</small><strong>${formatCost(record.cost)}</strong></div>
      <div class="record-cell record-comment"><small>КОММЕНТАРИЙ</small><strong>${escapeHtml(record.comment || "—")}</strong></div>
      <button class="delete-button" data-delete="${record.id}" aria-label="Удалить запись"><svg><use href="#i-trash"></use></svg></button>
    </article>
  `).join("");
  elements.empty.hidden = records.length > 0;
  elements.records.hidden = records.length === 0;
}

function render() {
  const car = activeCar();
  renderNav();
  elements.title.textContent = car.name;
  elements.subtitle.textContent = car.note || `Журнал обслуживания${car.year ? ` · ${car.year} год` : ""}`;
  elements.heroName.textContent = car.name;
  $("#carStatus").textContent = car.status || "На ходу";
  $("#carYear").textContent = car.year || "—";
  $("#carPlate").textContent = car.plate || "—";
  $("#carVin").textContent = car.vin || "—";
  elements.mileage.textContent = formatMileage(car.mileage);
  elements.count.textContent = car.records.length;
  elements.lastService.textContent = car.records.length
    ? formatDate(sortRecords([...car.records])[0].date)
    : "—";
  elements.photo.classList.toggle("has-photo", Boolean(car.photo));
  elements.photo.style.backgroundImage = car.photo ? `url("${car.photo}")` : "";
  $("#photoButton span").textContent = car.photo ? "Заменить фото" : "Добавить фото";
  renderRecords(car);
  updateSyncStatus();
  document.title = `${car.name} · Мой гараж`;
}

function escapeHtml(value) {
  const element = document.createElement("div");
  element.textContent = value;
  return element.innerHTML;
}

function openRecordDialog() {
  const car = activeCar();
  elements.recordForm.reset();
  elements.recordForm.elements.date.value = new Date().toISOString().slice(0, 10);
  elements.recordForm.elements.mileage.value = car.mileage || "";
  elements.recordDialog.showModal();
  setTimeout(() => elements.recordForm.elements.work.focus(), 50);
}

function closeMenu() {
  document.body.classList.remove("menu-open");
}

elements.nav.addEventListener("click", (event) => {
  const button = event.target.closest("[data-car-id]");
  if (!button) return;
  activeId = button.dataset.carId;
  location.hash = activeId;
  render();
  closeMenu();
  window.scrollTo({ top: 0, behavior: "smooth" });
});

["#addRecord", "#addRecordSecondary", "#emptyAdd"].forEach((selector) => {
  $(selector).addEventListener("click", openRecordDialog);
});

elements.recordForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const data = new FormData(elements.recordForm);
  const mileage = Number(data.get("mileage"));
  const car = activeCar();
  car.records.push({
    id: crypto.randomUUID(),
    work: String(data.get("work")).trim(),
    date: String(data.get("date")),
    mileage,
    cost: data.get("cost") === "" ? null : Number(data.get("cost")),
    comment: String(data.get("comment")).trim()
  });
  sortRecords(car.records);
  if (mileage > car.mileage) car.mileage = mileage;
  save();
  elements.recordDialog.close();
  render();
});

elements.records.addEventListener("click", (event) => {
  const button = event.target.closest("[data-delete]");
  if (!button) return;
  const car = activeCar();
  car.records = car.records.filter((record) => record.id !== button.dataset.delete);
  save();
  render();
});

$("#editMileage").addEventListener("click", () => {
  elements.mileageForm.elements.mileage.value = activeCar().mileage || "";
  elements.mileageDialog.showModal();
  setTimeout(() => elements.mileageForm.elements.mileage.select(), 50);
});

elements.mileageForm.addEventListener("submit", (event) => {
  event.preventDefault();
  activeCar().mileage = Number(new FormData(elements.mileageForm).get("mileage"));
  save();
  elements.mileageDialog.close();
  render();
});

$("#editCar").addEventListener("click", () => {
  const car = activeCar();
  ["name", "year", "mileage", "plate", "vin", "status", "note"].forEach((field) => {
    elements.carForm.elements[field].value = car[field] ?? "";
  });
  elements.carDialog.showModal();
});

elements.carForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const data = new FormData(elements.carForm);
  const car = activeCar();
  car.name = String(data.get("name")).trim();
  car.year = data.get("year") === "" ? "" : Number(data.get("year"));
  car.mileage = Number(data.get("mileage"));
  car.plate = String(data.get("plate")).trim().toUpperCase();
  car.vin = String(data.get("vin")).trim().toUpperCase();
  car.status = String(data.get("status"));
  car.note = String(data.get("note")).trim();
  car.meta = car.year ? `${car.year} год` : "Личный автомобиль";
  save();
  elements.carDialog.close();
  render();
});

document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-close-dialog]");
  if (!button) return;
  button.closest("dialog")?.close();
});

$("#syncSettings").addEventListener("click", () => {
  elements.syncForm.elements.url.value = syncSettings.googleScriptUrl || "";
  elements.syncForm.elements.pin.value = syncSettings.syncPin || "";
  elements.syncDialog.showModal();
});

elements.syncForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const data = new FormData(elements.syncForm);
  syncSettings = {
    googleScriptUrl: String(data.get("url")).trim(),
    syncPin: String(data.get("pin")).trim()
  };
  saveSyncSettings();
  elements.syncDialog.close();
  if (isSyncEnabled()) {
    startAutoPull();
    pullFromSheets({ silent: true });
  }
});

$("#pullFromSheets").addEventListener("click", pullFromSheets);
$("#refreshFromSheets").addEventListener("click", () => pullFromSheets({ silent: false }));

$("#photoButton").addEventListener("click", () => elements.photoInput.click());
elements.photoInput.addEventListener("change", () => {
  const file = elements.photoInput.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.addEventListener("load", () => {
    activeCar().photo = reader.result;
    save();
    render();
  });
  reader.readAsDataURL(file);
  elements.photoInput.value = "";
});

$("#menuButton").addEventListener("click", () => document.body.classList.toggle("menu-open"));
$("#sidebarBackdrop").addEventListener("click", closeMenu);
window.addEventListener("hashchange", () => {
  const id = location.hash.replace("#", "");
  if (cars.some((car) => car.id === id)) {
    activeId = id;
    render();
  }
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) pullFromSheets({ silent: true });
});

render();
startAutoPull();
