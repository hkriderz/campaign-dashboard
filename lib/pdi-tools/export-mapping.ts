import type {
  PdiQuestion,
  QuestionMappings,
  AnswerMappings,
  StwData,
  MappingOutput,
  OutputQuestionMapping,
  OutputAnswerMapping,
} from "./types";
import { buildFlagRegistry } from "./flag-registry";
import { mappingExportFileName as channelMappingFileName, type PdiSyncChannel } from "./channel";

export function buildMappingOutput(
  pdiQuestions: PdiQuestion[],
  stwData: StwData,
  questionMappings: QuestionMappings,
  answerMappings: AnswerMappings,
  channel: PdiSyncChannel = "dialer"
): MappingOutput {
  const flagRegistry = buildFlagRegistry(pdiQuestions);

  const outputQuestionMappings: OutputQuestionMapping[] = Object.entries(questionMappings).map(
    ([key, entry]) => {
      const [surveyName, stwQuestionName] = key.split("||");
      return {
        key,
        surveyName,
        stwQuestionName,
        pdiQuestionId: entry.pdiQuestionId,
        mode: entry.mode,
        confidence: entry.confidence,
        method: entry.method,
      };
    }
  );

  const outputAnswerMappings: OutputAnswerMapping[] = Object.entries(answerMappings).map(
    ([key, entry]) => {
      const [surveyName, stwQuestionName, stwAnswerValue] = key.split("||");
      return {
        key,
        surveyName,
        stwQuestionName,
        stwAnswerValue,
        pdiQuestionId: entry.pdiQuestionId,
        pdiAnswerOptionId: entry.pdiAnswerOptionId,
        pdiFlagId: entry.pdiFlagId,
        pdiFlagCode: entry.pdiFlagCode,
        pdiFlagDesc: entry.pdiFlagDesc,
        confidence: entry.confidence,
        method: entry.method,
      };
    }
  );

  return {
    schemaVersion: 2,
    generated: new Date().toISOString(),
    description:
      channel === "text"
        ? "STW Text tags → PDI schema unification mapping (question-first model)"
        : "STW → PDI schema unification mapping (question-first model)",
    stats: {
      totalQuestionMappings: outputQuestionMappings.length,
      totalAnswerMappings: outputAnswerMappings.length,
      surveys: Object.keys(stwData).length,
    },
    flagRegistry,
    questionMappings: outputQuestionMappings,
    answerMappings: outputAnswerMappings,
  };
}

export function mappingExportFileName(generatedIso?: string, channel: PdiSyncChannel = "dialer"): string {
  return channelMappingFileName(channel, generatedIso);
}

export function serializeMappingJson(output: MappingOutput): string {
  return JSON.stringify(output, null, 2);
}

export async function saveMappingExportToApp(
  output: MappingOutput,
  channel: PdiSyncChannel = "dialer"
): Promise<{
  ok: boolean;
  saved?: { fileName: string; absolutePath: string; id: string };
  mappingsDir?: string;
  error?: string;
}> {
  const res = await fetch("/api/pdi/mapping-export", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mapping: output, channel }),
  });
  const data = (await res.json()) as {
    ok?: boolean;
    saved?: { fileName: string; absolutePath: string; id: string };
    mappingsDir?: string;
    exportsDir?: string;
    error?: string;
  };
  if (!res.ok) {
    return { ok: false, error: data.error ?? res.statusText };
  }
  return {
    ok: true,
    saved: data.saved,
    mappingsDir: data.mappingsDir ?? data.exportsDir,
  };
}

export function downloadMappingJson(output: MappingOutput, channel: PdiSyncChannel = "dialer"): void {
  const filename = mappingExportFileName(output.generated, channel);
  const blob = new Blob([serializeMappingJson(output)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function loadMappingFromJson(raw: MappingOutput): {
  questionMappings: QuestionMappings;
  answerMappings: AnswerMappings;
} {
  const questionMappings: QuestionMappings = {};
  const answerMappings: AnswerMappings = {};

  for (const qm of raw.questionMappings ?? []) {
    questionMappings[qm.key] = {
      pdiQuestionId: qm.pdiQuestionId,
      mode: qm.mode,
      confidence: qm.confidence,
      method: qm.method,
    };
  }

  for (const am of raw.answerMappings ?? []) {
    answerMappings[am.key] = {
      pdiQuestionId: am.pdiQuestionId,
      pdiAnswerOptionId: am.pdiAnswerOptionId,
      pdiFlagId: am.pdiFlagId,
      pdiFlagCode: am.pdiFlagCode,
      pdiFlagDesc: am.pdiFlagDesc,
      confidence: am.confidence,
      method: am.method,
    };
  }

  return { questionMappings, answerMappings };
}
