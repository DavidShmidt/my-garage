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
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
  } else {
    const existingHeaders = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), headers.length)).getValues()[0];
    headers.forEach((header, index) => {
      if (existingHeaders[index] !== header) sheet.getRange(1, index + 1).setValue(header);
    });
  }
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
    if (row[7]) return;
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
    if (row[10]) return null;
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
  }).filter(car => car && car.id);
}

function writeCars_(cars) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const carsSheet = ensureSheet_("Cars", ["id", "name", "meta", "year", "plate", "vin", "status", "note", "mileage", "photo", "deleted_at", "updated_at"]);
    const recordsSheet = ensureSheet_("Records", ["id", "car_id", "date", "mileage", "work", "cost", "comment", "deleted_at", "updated_at"]);
    backup_(cars);

    const incomingCarIds = {};
    const incomingRecordIds = {};

    cars.forEach(car => {
      incomingCarIds[car.id] = true;
      upsertRow_(carsSheet, String(car.id), [
        car.id,
        car.name,
        car.meta,
        car.year || "",
        car.plate || "",
        car.vin || "",
        car.status || "На ходу",
        car.note || "",
        Number(car.mileage || 0),
        car.photo || "",
        "",
        new Date()
      ]);

      (car.records || []).forEach(record => {
        const recordId = String(record.id || Utilities.getUuid());
        incomingRecordIds[recordId] = true;
        upsertRow_(recordsSheet, recordId, [
          recordId,
          car.id,
          record.date,
          Number(record.mileage || 0),
          record.work || "",
          record.cost == null ? "" : Number(record.cost || 0),
          record.comment || "",
          "",
          new Date()
        ]);
      });
    });

    markMissingRowsDeleted_(carsSheet, incomingCarIds);
    markMissingRowsDeleted_(recordsSheet, incomingRecordIds);
  } finally {
    lock.releaseLock();
  }
}

function upsertRow_(sheet, id, values) {
  const row = findRowById_(sheet, id);
  if (row) {
    sheet.getRange(row, 1, 1, values.length).setValues([values]);
  } else {
    sheet.appendRow(values);
  }
}

function findRowById_(sheet, id) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;
  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (let index = 0; index < ids.length; index += 1) {
    if (String(ids[index][0]) === String(id)) return index + 2;
  }
  return 0;
}

function markMissingRowsDeleted_(sheet, activeIds) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  const rows = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
  const deletedAtColumn = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].indexOf("deleted_at") + 1;
  if (!deletedAtColumn) return;

  rows.forEach((row, index) => {
    const id = String(row[0] || "");
    const alreadyDeleted = row[deletedAtColumn - 1];
    if (id && !activeIds[id] && !alreadyDeleted) {
      sheet.getRange(index + 2, deletedAtColumn).setValue(new Date());
    }
  });
}

function backup_(cars) {
  const sheet = ensureSheet_("Backups", ["created_at", "json"]);
  sheet.appendRow([new Date(), JSON.stringify(cars)]);
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
