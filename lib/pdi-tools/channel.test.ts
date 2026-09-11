import test from "node:test";
import assert from "node:assert/strict";
import {
  isMappingFileForChannel,
  acquisitionTypeIdForChannel,
  DIALER_ACQUISITION_TYPE_ID,
  mappingAnswerKey,
  mappingExportFileName,
  mappingIdentitySurveyName,
  mappingQuestionKey,
  parsePdiSyncChannel,
  parseTextMappingScope,
  syncLockKey,
  syncStateKey,
  TEXT_ACQUISITION_TYPE_ID,
  TEXT_MAPPING_SURVEY_NAME,
} from "./channel";

test("parsePdiSyncChannel defaults to dialer", () => {
  assert.equal(parsePdiSyncChannel("text"), "text");
  assert.equal(parsePdiSyncChannel("dialer"), "dialer");
  assert.equal(parsePdiSyncChannel(null), "dialer");
  assert.equal(parsePdiSyncChannel("other"), "dialer");
});

test("Dialer mapping glob does not match text mapping files", () => {
  assert.equal(isMappingFileForChannel("stw_pdi_mapping_2026-09-06.json", "dialer"), true);
  assert.equal(isMappingFileForChannel("stw_text_pdi_mapping_2026-09-06.json", "dialer"), false);
  assert.equal(isMappingFileForChannel("stw_text_pdi_mapping_2026-09-06.json", "text"), true);
  assert.equal(isMappingFileForChannel("stw_pdi_mapping_2026-09-06.json", "text"), false);
});

test("channel keys stay isolated", () => {
  assert.equal(syncStateKey("dialer"), "global");
  assert.equal(syncStateKey("text"), "text");
  assert.equal(syncLockKey("dialer"), "global");
  assert.equal(syncLockKey("text"), "text");
  assert.equal(mappingExportFileName("text", "2026-09-06T00:00:00.000Z"), "stw_text_pdi_mapping_2026-09-06.json");
  assert.equal(mappingExportFileName("dialer", "2026-09-06T00:00:00.000Z"), "stw_pdi_mapping_2026-09-06.json");
  assert.equal(parseTextMappingScope("one"), "one");
  assert.equal(parseTextMappingScope("all"), "all");
  assert.equal(parseTextMappingScope(null), "all");
  assert.equal(
    mappingIdentitySurveyName("text", "Nithya Endorsement Announcement"),
    TEXT_MAPPING_SURVEY_NAME
  );
  assert.equal(
    mappingIdentitySurveyName("text", "Nithya Endorsement Announcement", "one"),
    "Nithya Endorsement Announcement"
  );
  assert.equal(mappingIdentitySurveyName("dialer", "Campaign A"), "Campaign A");
  assert.equal(mappingIdentitySurveyName("dialer", "Campaign A", "one"), "Campaign A");
  assert.equal(
    mappingQuestionKey("text", "Nithya Endorsement Announcement", "Support"),
    `${TEXT_MAPPING_SURVEY_NAME}||Support`
  );
  assert.equal(
    mappingQuestionKey("text", "Nithya Endorsement Announcement", "Support", "one"),
    "Nithya Endorsement Announcement||Support"
  );
  assert.equal(
    mappingAnswerKey("text", "Nithya Endorsement Announcement", "Support", "NithyaMayorYES"),
    `${TEXT_MAPPING_SURVEY_NAME}||Support||NithyaMayorYES`
  );
  assert.equal(
    mappingAnswerKey("text", "Nithya Endorsement Announcement", "Support", "NithyaMayorYES", "one"),
    "Nithya Endorsement Announcement||Support||NithyaMayorYES"
  );
  assert.equal(mappingAnswerKey("dialer", "Campaign A", "Support", "Yes"), "Campaign A||Support||Yes");
  assert.equal(acquisitionTypeIdForChannel("dialer"), DIALER_ACQUISITION_TYPE_ID);
  assert.equal(acquisitionTypeIdForChannel("text"), TEXT_ACQUISITION_TYPE_ID);
  assert.notEqual(TEXT_ACQUISITION_TYPE_ID, DIALER_ACQUISITION_TYPE_ID);
});
