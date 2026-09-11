/**
 * Image generation prompt.
 *
 * Generated imagery is decorative: a background or a lifestyle scene. The
 * prompt deliberately forbids inventing product details, logos or text, because
 * a generated image that misrepresents the product is worse than no image.
 */
export const productImageV1 = {
  id: "product-image",
  version: "v1",

  build({ product = {}, purpose = "marketing", language = "fa", instructions = "" } = {}) {
    const subject = [product.title, product.focus_keyword].filter(Boolean).join(" — ");
    const purposeText = {
      marketing: "a clean marketing background scene for this product, product centred, soft studio lighting",
      background_clean: "the same product on a plain neutral seamless background, e-commerce catalogue style",
      lifestyle: "the product in a realistic everyday use setting",
    }[purpose] || "a clean product photograph";

    return {
      prompt: [
        `Product photograph: ${subject}.`,
        purposeText,
        "Photorealistic, high detail, balanced composition, no watermark.",
        "Do not render any text, logo, brand mark, price or badge.",
        "Do not add accessories or features that were not described.",
        instructions ? `Additional art direction: ${instructions}` : "",
      ].filter(Boolean).join(" "),
      language,
      purpose,
    };
  },
};
