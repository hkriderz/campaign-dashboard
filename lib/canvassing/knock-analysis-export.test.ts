import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { buildKnockAnalysisWorkbook } from "./knock-analysis-export";
import type { CanvasserGapStats, CanvassingGapDetail, CanvassingReportResult } from "./types";
import type { KnockShiftSettings } from "./knock-report-view";

function stat(partial: Partial<CanvasserGapStats> & { canvasserName: string }): CanvasserGapStats {
  return {
    knockCount: 2,
    firstKnockAt: "2026-10-19T19:00:00.000Z",
    mostRecentKnockAt: "2026-10-19T21:00:00.000Z",
    largestGapMinutes: 70,
    largestGapStartAt: "2026-10-19T19:00:00.000Z",
    largestGapEndAt: "2026-10-19T20:10:00.000Z",
    totalGapMinutesOver10: 70,
    averageNonZeroGapMinutes: 70,
    averageGapEndingInContactMinutes: null,
    gapCountOver10: 1,
    bigGapCountOver30: 1,
    hourGapCount: 1,
    outlierGapCount: 0,
    ...partial,
  };
}

function gap(partial: Partial<CanvassingGapDetail> & { canvasserName: string; gapMinutes: number }): CanvassingGapDetail {
  return {
    startAt: "2026-10-19T19:00:00.000Z",
    endAt: "2026-10-19T20:10:00.000Z",
    isBigGap: partial.gapMinutes > 30,
    isHourGap: partial.gapMinutes >= 60,
    isOutlierGap: partial.gapMinutes >= 120,
    startVoter: "A",
    endVoter: "B",
    endResponse: "NH",
    sourceFileName: "knocks.xlsx",
    ...partial,
  };
}

const settings: KnockShiftSettings = {
  mode: "lunch",
  startTime: "12:30",
  lunchClockOutTime: "15:30",
  lunchReturnTime: "16:00",
  endTime: "19:30",
  asOfTime: "18:00",
};

function result(): CanvassingReportResult {
  const hour = gap({ canvasserName: "Davila, Dilan", gapMinutes: 70 });
  return {
    sourceFiles: [],
    summary: {
      detectedReportDate: "2026-10-19",
      totalSourceFiles: 1,
      knockDetailFiles: 1,
      campaignResultFiles: 1,
      unknownFiles: 0,
      totalKnockRows: 2,
      validKnockEvents: 2,
      invalidKnockRows: 0,
      totalCanvassers: 1,
      gapsOver10: 1,
      bigGapsOver30: 1,
      gapsOver60: 1,
      outlierGapsOver120: 0,
      totalGapMinutesOver10: 70,
      largestGapMinutes: 70,
    },
    canvasserStats: [stat({ canvasserName: "Davila, Dilan" })],
    gapDetails: [hour],
    bigGapDetails: [hour],
    hourGapDetails: [hour],
    outlierGapDetails: [],
    campaignResults: [
      {
        campaignName: "Boyle Heights",
        fileName: "bh.xlsx",
        sheetName: "Sheet1",
        rowCount: 2,
        canvasserCount: 1,
        resultColumns: ["SS", "U"],
        totals: { SS: 1, U: 1 },
        canvassers: [{ canvasserName: "Davila, Dilan", totals: { SS: 1, U: 1 } }],
      },
    ],
    validationIssues: [],
  };
}

test("knock analysis workbook splits the report into tabs", async () => {
  const bytes = await buildKnockAnalysisWorkbook({
    result: result(),
    title: "Knock analysis for Oct 19",
    reportDate: "2026-10-19",
    reportMode: "lunch",
    shiftSettings: settings,
    customGapMinutes: 45,
    excludedLeads: [stat({ canvasserName: "Nguyen, Dave", knockCount: 4 })],
    shiftStats: [stat({ canvasserName: "Davila, Dilan" })],
  });

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  assert.deepEqual(
    workbook.worksheets.map((sheet) => sheet.name),
    [
      "Pivot",
      "Late first knocks",
      "Still on lunch",
      "Gaps 45m+",
      "Gaps over 1 hour",
      "Outliers 2h+",
      "Gap lengths",
      "Gap details",
      "Big gap details",
      "Excluded",
      "Boyle Heights",
    ]
  );

  const pivot = workbook.getWorksheet("Pivot");
  const header = pivot?.getRow(1).getCell(5);
  assert.equal(header?.value, "First Knock");
  assert.equal(header?.font?.name, "Arial");
  assert.equal(header?.font?.size, 10);
  assert.equal(header?.font?.bold, true);
  assert.equal(header?.fill?.type, "pattern");
  if (header?.fill && header.fill.type === "pattern") {
    assert.equal(header.fill.fgColor?.argb, "FFD9EAD3");
  }
  assert.equal(header?.alignment?.horizontal, "left");
  assert.equal(pivot?.getRow(1).getCell(9).value, "average gap that ends in contact");
  const averageHeader = pivot?.getRow(1).getCell(8).fill;
  const averageArgb =
    averageHeader && averageHeader.type === "pattern" ? averageHeader.fgColor?.argb : undefined;
  assert.equal(averageArgb, undefined);
  assert.equal(pivot?.getRow(2).getCell(1).value, "Davila, Dilan");
  assert.equal(pivot?.getRow(2).getCell(1).alignment?.horizontal, "left");
  assert.equal(pivot?.getRow(2).getCell(2).alignment?.horizontal, "right");
  const nameFill = pivot?.getRow(2).getCell(1).fill;
  assert.equal(nameFill?.type, "pattern");
  if (nameFill && nameFill.type === "pattern") {
    assert.equal(nameFill.fgColor?.argb, "FFC9DAF8");
  }
  assert.equal(pivot?.getRow(2).getCell(1).font?.name, "Arial");
  assert.equal(pivot?.getRow(2).getCell(1).font?.bold, undefined);
  const gapCell = pivot?.getRow(2).getCell(2);
  if (gapCell?.fill && gapCell.fill.type === "pattern") {
    assert.equal(gapCell.fill.fgColor?.argb, "FFC9DAF8");
  }
  const hour = workbook.getWorksheet("Gaps over 1 hour");
  assert.equal(hour?.getRow(2).getCell(1).value, "Davila, Dilan");
  assert.equal(hour?.getRow(2).getCell(5).value, "B");
  const campaign = workbook.getWorksheet("Boyle Heights");
  assert.equal(campaign?.getRow(1).getCell(2).value, "SS");
  assert.equal(campaign?.getRow(3).getCell(1).value, "Total");
  assert.equal(campaign?.getRow(3).getCell(2).value, 1);
});

test("final mode uses a stopped-early tab instead of lunch tabs", async () => {
  const bytes = await buildKnockAnalysisWorkbook({
    result: result(),
    title: "Final",
    reportMode: "final",
    shiftSettings: { ...settings, mode: "final" },
    customGapMinutes: null,
    excludedLeads: [],
    shiftStats: [stat({ canvasserName: "Davila, Dilan" })],
  });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  const names = workbook.worksheets.map((sheet) => sheet.name);
  assert.equal(names.includes("Stopped early"), true);
  assert.equal(names.includes("Late first knocks"), false);
  assert.equal(names.includes("Gaps 45m+"), false);
  assert.equal(names.includes("Excluded"), false);
});
