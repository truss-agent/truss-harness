import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import type { RemoteSkillState, SkillMode, SkillSelection } from "./contracts";
import {
  type MobileSkillScope,
  skillAvailable,
  skillModeCopy,
  toggledSkill,
  toggledSuperpowers,
} from "./skills";

export interface SkillsViewProps {
  readonly state?: RemoteSkillState;
  readonly scope: MobileSkillScope;
  readonly hasSession: boolean;
  readonly busy: boolean;
  readonly error?: string;
  readonly onScope: (scope: MobileSkillScope) => void;
  readonly onSave: (selection: Partial<SkillSelection> | null) => void;
}

/** Skill controls for a paired host; imports stay on the computer. */
export function SkillsView({
  state,
  scope,
  hasSession,
  busy,
  error,
  onScope,
  onSave,
}: SkillsViewProps) {
  return (
    <View style={styles.page}>
      <View style={styles.intro}>
        <Text style={styles.title}>Skills</Text>
        <Text style={styles.body}>
          Instruction packs the agent can use on your paired computer. Changes
          apply to the next run. Import new skills on the computer.
        </Text>
      </View>

      <View style={styles.row}>
        {(["workspace", "session"] as const).map((candidate) => {
          const disabled = busy || (candidate === "session" && !hasSession);
          return (
            <Pressable
              key={candidate}
              accessibilityRole="button"
              accessibilityState={{ selected: scope === candidate, disabled }}
              disabled={disabled}
              style={[
                styles.choice,
                scope === candidate && styles.choiceSelected,
                disabled && styles.disabled,
              ]}
              onPress={() => onScope(candidate)}
            >
              <Text style={styles.choiceTitle}>
                {candidate === "workspace" ? "This workspace" : "This chat"}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {!state ? (
        <ActivityIndicator color="#74e3ba" />
      ) : (
        <>
          <Text style={styles.eyebrow}>MODE</Text>
          <View style={styles.row}>
            {(Object.keys(skillModeCopy) as SkillMode[]).map((mode) => (
              <Pressable
                key={mode}
                accessibilityRole="button"
                accessibilityState={{
                  selected: state.selection.mode === mode,
                  disabled: busy,
                }}
                disabled={busy}
                style={[
                  styles.choice,
                  state.selection.mode === mode && styles.choiceSelected,
                  busy && styles.disabled,
                ]}
                onPress={() => onSave({ mode })}
              >
                <Text style={styles.choiceTitle}>
                  {skillModeCopy[mode].title}
                </Text>
                <Text style={styles.choiceDetail}>
                  {skillModeCopy[mode].detail}
                </Text>
              </Pressable>
            ))}
          </View>

          <View style={styles.switchRow}>
            <Text style={styles.switchLabel}>Superpowers pack</Text>
            <Switch
              accessibilityLabel="Superpowers pack"
              disabled={busy}
              value={state.selection.superpowersEnabled}
              onValueChange={() => onSave(toggledSuperpowers(state.selection))}
            />
          </View>

          <Text style={styles.eyebrow}>ALWAYS ACTIVE</Text>
          <View style={styles.list}>
            {state.skills.map((skill) => {
              const selected = state.selection.skillIds.includes(skill.id);
              const available = skillAvailable(state, skill);
              const change = toggledSkill(state, skill);
              return (
                <Pressable
                  key={skill.id}
                  accessibilityRole="checkbox"
                  accessibilityState={{
                    checked: selected,
                    disabled: busy || !change,
                  }}
                  disabled={busy || !change}
                  style={[styles.skill, !available && styles.disabled]}
                  onPress={() => change && onSave(change)}
                >
                  <Text style={styles.check}>{selected ? "✓" : ""}</Text>
                  <View style={styles.skillText}>
                    <Text style={styles.skillName}>{skill.id}</Text>
                    <Text style={styles.skillDescription} numberOfLines={2}>
                      {skill.trusted
                        ? skill.description
                        : "Found in the repository. Import it on the computer to use it."}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>

          {scope === "workspace" && (
            <Pressable
              disabled={busy}
              style={styles.textButton}
              onPress={() => onSave(null)}
            >
              <Text style={styles.textButtonText}>
                Clear this workspace's choices
              </Text>
            </Pressable>
          )}
        </>
      )}
      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { gap: 14 },
  intro: { gap: 9, paddingTop: 8 },
  title: { color: "#f1f8f5", fontSize: 28, fontWeight: "800", lineHeight: 34 },
  body: { color: "#a3b6ae", fontSize: 15, lineHeight: 22 },
  eyebrow: { color: "#7f978e", fontSize: 11, fontWeight: "800" },
  row: { flexDirection: "row", gap: 8 },
  choice: {
    backgroundColor: "#121d19",
    borderColor: "#263b33",
    borderRadius: 10,
    borderWidth: 1,
    flex: 1,
    gap: 2,
    minHeight: 48,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  choiceSelected: { backgroundColor: "#174232", borderColor: "#5bd4a9" },
  choiceTitle: { color: "#d4e1dc", fontSize: 14, fontWeight: "800" },
  choiceDetail: { color: "#7f968d", fontSize: 11, lineHeight: 14 },
  switchRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  switchLabel: { color: "#d4e1dc", fontSize: 15, fontWeight: "700" },
  list: { gap: 8 },
  skill: {
    alignItems: "flex-start",
    backgroundColor: "#101b17",
    borderRadius: 10,
    flexDirection: "row",
    gap: 10,
    minHeight: 48,
    padding: 12,
  },
  check: { color: "#8ee9c3", fontSize: 16, fontWeight: "800", width: 16 },
  skillText: { flex: 1, gap: 3 },
  skillName: { color: "#e4efea", fontSize: 14, fontWeight: "700" },
  skillDescription: { color: "#a9bbb4", fontSize: 12, lineHeight: 17 },
  textButton: {
    alignSelf: "flex-start",
    justifyContent: "center",
    minHeight: 35,
  },
  textButtonText: { color: "#99e4c6", fontSize: 14, fontWeight: "700" },
  error: { color: "#f0a0a0", fontSize: 13 },
  disabled: { opacity: 0.42 },
});
