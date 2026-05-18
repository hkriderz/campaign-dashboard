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

export function buildMappingOutput(
  pdiQuestions: PdiQuestion[],
  stwData: StwData,
  questionMappings: QuestionMappings,
  answerMappings: AnswerMappings
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
    description: "STW → PDI schema unification mapping (question-first model)",
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

export function mappingExportFileName(generatedIso?: string): string {
  const date = (generatedIso ?? new Date().toISOString()).slice(0, 10);
  return `stw_pdi_mapping_${date}.json`;
}

export function serializeMappingJson(output: MappingOutput): string {
  return JSON.stringify(output, null, 2);
}

export async function saveMappingExportToApp(output: MappingOutput): Promise<{
  ok: boolean;
  saved?: { fileName: string; absolutePath: string; id: string };
  mappingsDir?: string;
  error?: string;
}> {
  const res = await fetch("/api/pdi/mapping-export", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mapping: output }),
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

export function downloadMappingJson(output: MappingOutput): void {
  const filename = mappingExportFileName(output.generated);
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
