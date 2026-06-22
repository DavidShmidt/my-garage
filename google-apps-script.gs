const SPREADSHEET_ID = "PASTE_SPREADSHEET_ID_HERE";
const SYNC_PIN = "2115";

function doGet(e) {
  if (!isAuthorized_(e)) return jsonp_(e, { ok: false, error: "unauthorized" });

  const action = String(e.parameter.action || "load");
  if (action !== "load") return jsonp_(e, { ok: false, error: "unknown_action" });

  return jsonp_(e, {
    ok: true,
    savedAt: new Date().toISOString(),
    cars: readCars_()
  });
}

function doPost(e) {
  if (!isAuthorized_(e)) return text_({ ok: false, error: "unauthorized" });

  const payload = JSON.parse(e.parameter.payload || "{}");
  if (!Array.isArray(payload.cars)) return text_({ ok: false, error: "bad_payload" });

  writeCars_(payload.cars);
  return text_({ ok: true, savedAt: new Date().toISOString() });
}

function isAuthorized_(e) {
  return String(e.parameter.pin || "") === SYNC_PIN;
}

function ss_() {
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

function ensureSheet_(name, headers) {
  const spreadsheet = ss_();
  let sheet = spreadsheet.getSheetByName(name);
  if (!sheet) sheet = spreadsheet.insertSheet(name);
  sheet.clear();
  sheet.appendRow(headers);
  return sheet;
}

function readCars_() {
  const spreadsheet = ss_();
  const carsSheet = spreadsheet.getSheetByName("Cars");
  const recordsSheet = spreadsheet.getSheetByName("Records");
  if (!carsSheet) return [];

  const carsRows = carsSheet.getDataRange().getValues().slice(1);
  const recordRows = recordsSheet ? recordsSheet.getDataRange().getValues().slice(1) : [];
  const recordsByCar = {};

  recordRows.forEach(row => {
    const record = {
      id: String(row[0] || Utilities.getUuid()),
      date: toIsoDate_(row[2]),
      mileage: Number(row[3] || 0),
      work: String(row[4] || ""),
      cost: row[5] === "" ? null : Number(row[5] || 0),
      comment: String(row[6] || "")
    };
    const carId = String(row[1] || "");
    if (!recordsByCar[carId]) recordsByCar[carId] = [];
    recordsByCar[carId].push(record);
  });

  return carsRows.map(row => {
    const id = String(row[0] || "");
    return {
      id,
      name: String(row[1] || ""),
      meta: String(row[2] || ""),
      year: row[3] === "" ? "" : Number(row[3] || 0),
      plate: String(row[4] || ""),
      vin: String(row[5] || ""),
      status: String(row[6] || "На ходу"),
      note: String(row[7] || ""),
      mileage: Number(row[8] || 0),
      photo: String(row[9] || ""),
      records: recordsByCar[id] || []
    };
  }).filter(car => car.id);
}

function writeCars_(cars) {
  const carsSheet = ensureSheet_("Cars", ["id", "name", "meta", "year", "plate", "vin", "status", "note", "mileage", "photo"]);
  const recordsSheet = ensureSheet_("Records", ["id", "car_id", "date", "mileage", "work", "cost", "comment"]);

  const carValues = [];
  const recordValues = [];

  cars.forEach(car => {
    carValues.push([
      car.id,
      car.name,
      car.meta,
      car.year || "",
      car.plate || "",
      car.vin || "",
      car.status || "На ходу",
      car.note || "",
      Number(car.mileage || 0),
      car.photo || ""
    ]);

    (car.records || []).forEach(record => {
      recordValues.push([
        record.id || Utilities.getUuid(),
        car.id,
        record.date,
        Number(record.mileage || 0),
        record.work || "",
        record.cost == null ? "" : Number(record.cost || 0),
        record.comment || ""
      ]);
    });
  });

  if (carValues.length) carsSheet.getRange(2, 1, carValues.length, carValues[0].length).setValues(carValues);
  if (recordValues.length) recordsSheet.getRange(2, 1, recordValues.length, recordValues[0].length).setValues(recordValues);
}

function toIsoDate_(value) {
  if (Object.prototype.toString.call(value) === "[object Date]") {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), "yyyy-MM-dd");
  }
  return String(value || "");
}

function text_(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

function jsonp_(e, data) {
  const callback = String(e.parameter.callback || "callback").replace(/[^\w.$]/g, "");
  return ContentService
    .createTextOutput(`${callback}(${JSON.stringify(data)});`)
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}
