import { productAnalysisV1 } from "./productAnalysis.v1.js";
import { productContentV1 } from "./productContent.v1.js";
import { productSeoV1 } from "./productSeo.v1.js";
import { productTagsV1 } from "./productTags.v1.js";
import { productImageV1 } from "./productImage.v1.js";

/**
 * Prompt registry.
 *
 * Prompts are versioned and the version used is stored with every generation:
 * when a prompt changes, older drafts still say which text produced them, and a
 * regression can be traced to a specific version rather than guessed at.
 */
const PROMPTS = new Map([
  ["product-analysis", { v1: productAnalysisV1 }],
  ["product-content", { v1: productContentV1 }],
  ["product-seo", { v1: productSeoV1 }],
  ["product-tags", { v1: productTagsV1 }],
  ["product-image", { v1: productImageV1 }],
]);

export const CURRENT_PROMPT_VERSIONS = Object.freeze({
  "product-analysis": "v1",
  "product-content": "v1",
  "product-seo": "v1",
  "product-tags": "v1",
  "product-image": "v1",
});

export function getPrompt(id, version = CURRENT_PROMPT_VERSIONS[id]) {
  const versions = PROMPTS.get(id);
  if (!versions) throw new Error(`Unknown prompt: ${id}`);
  const prompt = versions[version];
  if (!prompt) throw new Error(`Unknown version ${version} for prompt ${id}`);
  return prompt;
}

/** Stamped onto every draft so results stay traceable to their prompts. */
export const promptStamp = (ids) => Object.fromEntries(
  ids.map((id) => [id, `${id}@${CURRENT_PROMPT_VERSIONS[id]}`]),
);

export { productAnalysisV1, productContentV1, productSeoV1, productTagsV1, productImageV1 };
