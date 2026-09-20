// Tiny edit-mode check shared by the viewer and the (lazy-loaded) editor.
//
// It lives in its own module so main.ts and sidebar.ts can branch on edit mode
// without statically importing ./editor, which would pull the whole editor into
// the bundle every viewer downloads.
import { EDIT_PATH } from './config'

export function isEditMode(): boolean {
  return location.pathname.replace(/\/+$/, '') === EDIT_PATH.replace(/\/+$/, '') || new URLSearchParams(location.search).get('edit') === '1'
}
