import { colorFields, directories, entryLengths, entryLimit, textFields, type Directory, type WebsiteDraft } from '../../lib/website-draft';

export function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}

export function editor(draft: WebsiteDraft, revision: number, message: string) {
  const sections = (Object.keys(directories) as Directory[]).map(key => {
    const group = directories[key];
    const row = (entry: WebsiteDraft[Directory][number]) => `<fieldset data-entry>
      <legend>${escapeHtml(entry.name || 'New ' + group.singular)}</legend>
      <div class="editor-grid">
        ${(Object.keys(entryLengths) as (keyof typeof entryLengths)[]).map(field => {
          const name = key + '-' + field;
          const attrs = `name="${name}" maxlength="${entryLengths[field]}"`;
          const value = escapeHtml(entry[field]);
          const control = field === 'description' ? `<textarea ${attrs} rows="3">${value}</textarea>`
            : `<input ${attrs} type="${field === 'image' ? 'url' : 'text'}" value="${value}" ${field === 'name' ? 'required' : ''}>`;
          return `<label>${group.fields[field]}${control}</label>`;
        }).join('')}
      </div>
      <button type="button" data-remove>Remove entry</button>
    </fieldset>`;
    return `<details data-directory data-limit="${entryLimit}"><summary>${group.label} <span>(${draft[key].length})</span></summary>
      <div data-entries>${draft[key].map(row).join('')}</div>
      <template>${row({ name: '', detail: '', description: '', image: '' })}</template>
      <button type="button" data-add>Add ${group.singular}</button>
    </details>`;
  }).join('');
  return `<section class="website-editor wrap">
    <h1>Edit website draft</h1>
    <p>Save to update the private preview. Directory entries are curated here. Photo and logo fields accept public HTTPS image links.</p>
    ${message ? `<p role="alert">${escapeHtml(message)}</p>` : ''}
    <form method="post" action="/website-preview?edit=1">
      <input type="hidden" name="revision" value="${revision}">
      <fieldset><legend>Homepage and contact</legend><div class="editor-grid">
        ${(Object.keys(textFields) as (keyof typeof textFields)[]).map(key => {
          const { label, limit } = textFields[key];
          const attrs = `name="${key}" maxlength="${limit}" required`;
          const value = escapeHtml(draft[key]);
          return `<label>${label}${key === 'intro' ? `<textarea ${attrs} rows="3">${value}</textarea>` : `<input ${attrs} type="${key === 'email' ? 'email' : 'text'}" value="${value}">`}</label>`;
        }).join('')}
      </div></fieldset>
      <fieldset><legend>Website colors</legend><div class="editor-grid">
        ${(Object.keys(colorFields) as (keyof typeof colorFields)[]).map(key => `<label class="color-field"><input type="color" name="${key}" value="${escapeHtml(draft.colors[key])}"><span>${colorFields[key]}</span></label>`).join('')}
      </div></fieldset>
      ${sections}
      <button type="submit">Save draft and view preview</button>
      <a href="/website-preview">Cancel</a>
    </form>
    <script defer src="/swa-website-editor.js"></script>
  </section>`;
}
