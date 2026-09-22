import Sample.Basic

/-- The square of a natural number. -/
def square (n : Nat) : Nat := n * n

theorem square_eq_mul (n : Nat) : square n = n * n := by
  rfl

theorem twice_le_square (n : Nat) (h : 2 ≤ n) : twice n ≤ square n := by
  unfold twice square
  sorry
