for (const group of document.querySelectorAll('[data-directory]')) {
  const entries = group.querySelector('[data-entries]');
  const template = group.querySelector('template');
  const add = group.querySelector('[data-add]');
  const count = group.querySelector('summary span');
  const updateCount = () => {
    count.textContent = '(' + entries.children.length + ')';
    add.disabled = entries.children.length >= Number(group.dataset.limit);
  };
  group.addEventListener('click', event => {
    if (event.target === add) {
      const row = template.content.cloneNode(true);
      entries.append(row);
      entries.lastElementChild.querySelector('input').focus();
    }
    if (event.target.matches('[data-remove]')) {
      event.target.closest('[data-entry]').remove();
      add.focus();
    }
    updateCount();
  });
  updateCount();
}

const form = document.querySelector('.website-editor form');
form.addEventListener('invalid', event => {
  const group = event.target.closest('details');
  if (group) group.open = true;
}, true);
