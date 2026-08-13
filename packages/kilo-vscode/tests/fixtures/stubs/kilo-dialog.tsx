import type { JSX } from "solid-js"
export function Dialog(props: { title?: JSX.Element; children?: JSX.Element }) {
  return (
    <div data-stub-dialog>
      {props.title}
      {props.children}
    </div>
  )
}
