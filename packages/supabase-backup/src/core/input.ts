/**
 * The description of one configuration value.
 *
 * A field is the single place a setting is defined: the flag that carries it,
 * the question asked when the flag is absent, and the check both paths run. A
 * component that needs its own settings — a storage adapter, say — owns the
 * fields for them, so the CLI can ask for exactly what the chosen component
 * needs and nothing else.
 */
export interface InputField {
  defaultValue?: string;
  flag: string;
  name: string;
  /** Carried by its flag only: never asked for, and unset when it is absent. */
  optional?: boolean;
  question: string;
  secret?: boolean;
  validate?: (value: string) => void;
}

/** Values a command was given or asked for, keyed by configuration name. */
export type InputValues = Record<string, string | undefined>;
