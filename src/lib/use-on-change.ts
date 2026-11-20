import { useState } from 'react'

/**
 * Runs `onChange` during render when `value` changes, e.g. to reset a dialog's form when it opens.
 * This is React's "adjust state while rendering" pattern, which avoids an extra effect pass.
 */
export function useOnChange<T>(value: T, onChange: (value: T) => void) {
  const [prev, setPrev] = useState(value)
  if (!Object.is(prev, value)) {
    setPrev(value)
    onChange(value)
  }
}
