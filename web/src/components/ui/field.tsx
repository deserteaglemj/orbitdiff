import { useId, type ComponentProps, type ReactNode } from "react";

import { cx, describedBy } from "./classes";

const CONTROL =
  "min-h-10 w-full rounded-lg border border-edge bg-ground px-3 text-base text-ink " +
  "placeholder:text-muted disabled:cursor-not-allowed disabled:opacity-50 " +
  "aria-invalid:border-2 aria-invalid:border-danger";

/** Supporting text under a control. Reference it from the control with `aria-describedby`. */
export function FieldHint({ id, children, className }: { id: string; children: ReactNode; className?: string }) {
  return (
    <p id={id} className={cx("text-sm text-muted", className)}>
      {children}
    </p>
  );
}

/** A validation message under a control. The word "Error" carries the meaning without colour. */
export function FieldError({ id, children, className }: { id: string; children: ReactNode; className?: string }) {
  return (
    <p id={id} className={cx("text-sm text-danger", className)}>
      <span className="font-semibold">Error: </span>
      {children}
    </p>
  );
}

/**
 * A form-level failure. It is announced as soon as it appears. Render it in a fixed place above the
 * submit button and pass nothing when there is no error.
 */
export function FormError({ children, className }: { children?: ReactNode; className?: string }) {
  if (children === null || children === undefined || children === false || children === "") {
    return null;
  }
  return (
    <div
      role="alert"
      className={cx("rounded-lg border-2 border-danger bg-danger-tint px-4 py-3 text-sm text-ink", className)}
    >
      <span className="font-semibold">Error: </span>
      {children}
    </div>
  );
}

interface FieldShell {
  label: ReactNode;
  /** Supporting text, wired to the control with `aria-describedby`. */
  hint?: ReactNode;
  /** Validation message. Also sets `aria-invalid` on the control. */
  error?: ReactNode;
  /** Classes for the wrapper around label, control, hint, and error. */
  className?: string;
}

function FieldLabel({ htmlFor, required, children }: { htmlFor: string; required?: boolean; children: ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="text-sm font-medium text-ink">
      {children}
      {required ? <span className="font-normal text-muted"> (required)</span> : null}
    </label>
  );
}

function FieldMessages({ id, hint, error }: { id: string; hint?: ReactNode; error?: ReactNode }) {
  return (
    <>
      {hint ? <FieldHint id={`${id}-hint`}>{hint}</FieldHint> : null}
      {error ? <FieldError id={`${id}-error`}>{error}</FieldError> : null}
    </>
  );
}

export interface TextFieldProps extends FieldShell, Omit<ComponentProps<"input">, "className"> {
  inputClassName?: string;
}

export function TextField({ label, hint, error, className, inputClassName, id, ...input }: TextFieldProps) {
  const generated = useId();
  const fieldId = id ?? generated;
  return (
    <div className={cx("grid gap-2", className)}>
      <FieldLabel htmlFor={fieldId} required={input.required}>
        {label}
      </FieldLabel>
      <input
        id={fieldId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(hint ? `${fieldId}-hint` : undefined, error ? `${fieldId}-error` : undefined)}
        className={cx(CONTROL, inputClassName)}
        {...input}
      />
      <FieldMessages id={fieldId} hint={hint} error={error} />
    </div>
  );
}

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectFieldProps extends FieldShell, Omit<ComponentProps<"select">, "className"> {
  /** Options to render. Pass `children` instead for option groups. */
  options?: SelectOption[];
  selectClassName?: string;
}

export function SelectField({
  label,
  hint,
  error,
  className,
  selectClassName,
  options,
  children,
  id,
  ...select
}: SelectFieldProps) {
  const generated = useId();
  const fieldId = id ?? generated;
  return (
    <div className={cx("grid gap-2", className)}>
      <FieldLabel htmlFor={fieldId} required={select.required}>
        {label}
      </FieldLabel>
      <select
        id={fieldId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(hint ? `${fieldId}-hint` : undefined, error ? `${fieldId}-error` : undefined)}
        className={cx(CONTROL, selectClassName)}
        {...select}
      >
        {options
          ? options.map((option) => (
              <option key={option.value} value={option.value} disabled={option.disabled}>
                {option.label}
              </option>
            ))
          : children}
      </select>
      <FieldMessages id={fieldId} hint={hint} error={error} />
    </div>
  );
}

export interface CheckboxFieldProps extends FieldShell, Omit<ComponentProps<"input">, "className" | "type"> {}

export function CheckboxField({ label, hint, error, className, id, ...input }: CheckboxFieldProps) {
  const generated = useId();
  const fieldId = id ?? generated;
  return (
    <div className={cx("grid gap-1", className)}>
      <div className="flex min-h-10 items-start gap-3 py-2">
        <input
          id={fieldId}
          type="checkbox"
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(hint ? `${fieldId}-hint` : undefined, error ? `${fieldId}-error` : undefined)}
          className="size-6 shrink-0 rounded accent-blue disabled:cursor-not-allowed disabled:opacity-50"
          {...input}
        />
        <label htmlFor={fieldId} className="pt-0.5 text-sm text-ink">
          {label}
          {input.required ? <span className="text-muted"> (required)</span> : null}
        </label>
      </div>
      <div className="grid gap-1 pl-9">
        <FieldMessages id={fieldId} hint={hint} error={error} />
      </div>
    </div>
  );
}
