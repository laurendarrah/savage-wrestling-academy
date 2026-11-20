// The typed word for a permanent delete (issue #388). The page asks the owner to type DELETE before the button works
// (public/delete-confirm.js); the server checks it again, so a delete never happens from a stray click or request.
export const DELETE_WORD = 'DELETE';
export const confirmsDelete = (v: unknown) => typeof v === 'string' && v.length <= 20 && v.trim().toLowerCase() === 'delete';
export const TYPE_DELETE = 'Type DELETE to confirm, then try again.';
