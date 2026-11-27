/*
 * Cash and Documents / IDs are masked on every public surface: search (#124),
 * browse and item details (#108) and announcement drafts (#106). The SQL
 * masking helpers use the same category spellings.
 */
export const DOCUMENT_TITLE = 'Documents / IDs';
const DOCUMENT_CATEGORIES = ['documents / ids', 'document/id'];

const categoryKey = (category) => String(category ?? '').trim().toLowerCase();

/** True for both the current and the legacy Documents / IDs spelling. */
export const isDocumentCategory = (category) =>
  DOCUMENT_CATEGORIES.includes(categoryKey(category));

/** True when the item is cash, by flag or by category. */
export const isCashItem = ({ category, isCash } = {}) =>
  isCash === true || categoryKey(category) === 'cash';
