/-- Doubling a natural number. -/
def twice (n : Nat) : Nat := n + n

theorem twice_eq (n : Nat) : twice n = n + n := by
  rfl

theorem twice_zero : twice 0 = 0 := by
  rfl
