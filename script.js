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
    image: "assets/cars/vaz-2115.png",
    photo: "",
    tasks: [
      { id: crypto.randomUUID(), title: "Проверить тормоза", dueDate: "", mileage: 322000, priority: "Обычная", status: "Нужно сделать", comment: "Осмотреть колодки и направляющие" }
    ],
    records: [
      { id: crypto.randomUUID(), date: "2024-05-15", mileage: 312000, work: "Замена масла и масляного фильтра", cost: 1800, comment: "Лукойл 10W-40" },
      { id: crypto.randomUUID(), date: "2024-02-02", mileage: 304500, work: "Регулировка клапанов", cost: 2000, comment: "Холодная регулировка" },
      { id: crypto.randomUUID(), date: "2023-10-21", mileage: 298000, work: "Проверка лямбда-зонда", cost: 1200, comment: "Показания в норме" }
    ]
  },
  { id: "polo-sedan", name: "VW Polo Sedan", meta: "5 поколение", year: "", plate: "", vin: "", status: "На ходу", note: "", mileage: 0, image: "assets/cars/polo-sedan.png", photo: "", tasks: [], records: [] },
  { id: "renault-sandero", name: "Renault Sandero", meta: "Личный автомобиль", year: "", plate: "", vin: "", status: "На ходу", note: "", mileage: 0, image: "assets/cars/renault-sandero.png", photo: "", tasks: [], records: [] },
  { id: "lada-largus", name: "Lada Largus", meta: "Личный автомобиль", year: "", plate: "", vin: "", status: "На ходу", note: "", mileage: 0, image: "assets/cars/lada-largus.png", photo: "", tasks: [], records: [] }
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
let editingRecordId = null;
let editingTaskId = null;

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
  tasks: $("#tasksList"),
  emptyTasks: $("#emptyTasks"),
  recordDialog: $("#recordDialog"),
  recordForm: $("#recordForm"),
  recordDialogTitle: $("#recordDialogTitle"),
  taskDialog: $("#taskDialog"),
  taskForm: $("#taskForm"),
  taskDialogTitle: $("#taskDialogTitle"),
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
const sortTasks = (tasks) => tasks.sort((a, b) => {
  const statusScore = { "Нужно сделать": 0, "В работе": 1, "Сделано": 2 };
  const priorityScore = { "Срочно": 0, "Скоро": 1, "Обычная": 2 };
  return (statusScore[a.status] ?? 0) - (statusScore[b.status] ?? 0)
    || (priorityScore[a.priority] ?? 2) - (priorityScore[b.priority] ?? 2)
    || (a.dueDate || "9999-12-31").localeCompare(b.dueDate || "9999-12-31")
    || Number(a.mileage || 0) - Number(b.mileage || 0);
});

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
    cars.forEach((car) => {
      car.records ||= [];
      car.tasks ||= [];
    });
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
      <div class="record-actions">
        <button class="row-button" data-edit-record="${record.id}" aria-label="Редактировать запись"><svg><use href="#i-edit"></use></svg></button>
        <button class="row-button danger" data-delete="${record.id}" aria-label="Удалить запись"><svg><use href="#i-trash"></use></svg></button>
      </div>
    </article>
  `).join("");
  elements.empty.hidden = records.length > 0;
  elements.records.hidden = records.length === 0;
}

function renderTasks(car) {
  const tasks = sortTasks([...(car.tasks || [])]);
  elements.tasks.innerHTML = tasks.map((task) => `
    <article class="task ${task.status === "Сделано" ? "done" : ""}">
      <button class="task-check" data-toggle-task="${task.id}" aria-label="Отметить задачу">
        <svg><use href="#i-check"></use></svg>
      </button>
      <div class="task-main">
        <div class="task-top">
          <strong>${escapeHtml(task.title)}</strong>
          <span class="task-priority ${priorityClass(task.priority)}">${escapeHtml(task.priority || "Обычная")}</span>
        </div>
        <p>${task.dueDate ? `до ${formatDate(task.dueDate)}` : "без даты"}${task.mileage ? ` · ${formatMileage(task.mileage)} км` : ""}${task.comment ? ` · ${escapeHtml(task.comment)}` : ""}</p>
      </div>
      <div class="record-actions">
        <button class="row-button" data-edit-task="${task.id}" aria-label="Редактировать задачу"><svg><use href="#i-edit"></use></svg></button>
        <button class="row-button danger" data-delete-task="${task.id}" aria-label="Удалить задачу"><svg><use href="#i-trash"></use></svg></button>
      </div>
    </article>
  `).join("");
  elements.emptyTasks.hidden = tasks.length > 0;
  elements.tasks.hidden = tasks.length === 0;
}

function priorityClass(priority) {
  if (priority === "Срочно") return "urgent";
  if (priority === "Скоро") return "soon";
  return "";
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
  const carImage = car.photo || car.image || "";
  elements.photo.classList.toggle("has-photo", Boolean(carImage));
  elements.photo.style.backgroundImage = carImage ? `url("${carImage}")` : "";
  $("#photoButton span").textContent = car.photo ? "Заменить фото" : "Добавить фото";
  renderTasks(car);
  renderRecords(car);
  updateSyncStatus();
  document.title = `${car.name} · Мой гараж`;
}

function escapeHtml(value) {
  const element = document.createElement("div");
  element.textContent = value;
  return element.innerHTML;
}

function openRecordDialog(recordId = null) {
  const car = activeCar();
  elements.recordForm.reset();
  editingRecordId = recordId;
  elements.recordDialogTitle.textContent = recordId ? "Редактировать работу" : "Новая работа";
  const record = car.records.find((item) => item.id === recordId);
  elements.recordForm.elements.work.value = record?.work || "";
  elements.recordForm.elements.date.value = record?.date || new Date().toISOString().slice(0, 10);
  elements.recordForm.elements.mileage.value = record?.mileage || car.mileage || "";
  elements.recordForm.elements.cost.value = record?.cost ?? "";
  elements.recordForm.elements.comment.value = record?.comment || "";
  elements.recordDialog.showModal();
  setTimeout(() => elements.recordForm.elements.work.focus(), 50);
}

function openTaskDialog(taskId = null) {
  const car = activeCar();
  elements.taskForm.reset();
  editingTaskId = taskId;
  elements.taskDialogTitle.textContent = taskId ? "Редактировать задачу" : "Новая задача";
  const task = (car.tasks || []).find((item) => item.id === taskId);
  elements.taskForm.elements.title.value = task?.title || "";
  elements.taskForm.elements.dueDate.value = task?.dueDate || "";
  elements.taskForm.elements.mileage.value = task?.mileage || "";
  elements.taskForm.elements.priority.value = task?.priority || "Обычная";
  elements.taskForm.elements.status.value = task?.status || "Нужно сделать";
  elements.taskForm.elements.comment.value = task?.comment || "";
  elements.taskDialog.showModal();
  setTimeout(() => elements.taskForm.elements.title.focus(), 50);
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
  $(selector).addEventListener("click", () => openRecordDialog());
});

["#addTask", "#emptyTaskAdd"].forEach((selector) => {
  $(selector).addEventListener("click", () => openTaskDialog());
});

elements.recordForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const data = new FormData(elements.recordForm);
  const mileage = Number(data.get("mileage"));
  const car = activeCar();
  const record = editingRecordId
    ? car.records.find((item) => item.id === editingRecordId)
    : null;
  const nextRecord = {
    id: record?.id || crypto.randomUUID(),
    work: String(data.get("work")).trim(),
    date: String(data.get("date")),
    mileage,
    cost: data.get("cost") === "" ? null : Number(data.get("cost")),
    comment: String(data.get("comment")).trim()
  };
  if (record) {
    Object.assign(record, nextRecord);
  } else {
    car.records.push(nextRecord);
  }
  sortRecords(car.records);
  if (mileage > car.mileage) car.mileage = mileage;
  editingRecordId = null;
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

elements.records.addEventListener("click", (event) => {
  const button = event.target.closest("[data-edit-record]");
  if (!button) return;
  openRecordDialog(button.dataset.editRecord);
});

elements.tasks.addEventListener("click", (event) => {
  const car = activeCar();
  const completeButton = event.target.closest("[data-toggle-task]");
  if (completeButton) {
    const task = (car.tasks || []).find((item) => item.id === completeButton.dataset.toggleTask);
    if (!task) return;
    task.status = task.status === "Сделано" ? "Нужно сделать" : "Сделано";
    save();
    render();
    return;
  }

  const editButton = event.target.closest("[data-edit-task]");
  if (editButton) {
    openTaskDialog(editButton.dataset.editTask);
    return;
  }

  const deleteButton = event.target.closest("[data-delete-task]");
  if (!deleteButton) return;
  car.tasks = (car.tasks || []).filter((task) => task.id !== deleteButton.dataset.deleteTask);
  save();
  render();
});

elements.taskForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const data = new FormData(elements.taskForm);
  const car = activeCar();
  car.tasks ||= [];
  const task = editingTaskId
    ? car.tasks.find((item) => item.id === editingTaskId)
    : null;
  const nextTask = {
    id: task?.id || crypto.randomUUID(),
    title: String(data.get("title")).trim(),
    dueDate: String(data.get("dueDate") || ""),
    mileage: data.get("mileage") === "" ? "" : Number(data.get("mileage")),
    priority: String(data.get("priority") || "Обычная"),
    status: String(data.get("status") || "Нужно сделать"),
    comment: String(data.get("comment")).trim()
  };
  if (task) {
    Object.assign(task, nextTask);
  } else {
    car.tasks.push(nextTask);
  }
  sortTasks(car.tasks);
  editingTaskId = null;
  save();
  elements.taskDialog.close();
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
