"""Test deduplication logic for mobile API"""
holdings = [
    ('EQQQ', 53.0, 1.0, 616.30, 32663.90),
    ('EQQU', 53.0, 1.0, 529.00, 28037.00),
]

def normalize_symbol(symbol: str) -> str:
    normalized = symbol.upper().strip()
    if normalized == 'EQQU':
        return 'EQQQ'
    return normalized

# Deduplicate
deduplicated = {}
for symbol, position, fx_rate, mark_price, position_value in holdings:
    normalized = normalize_symbol(symbol)
    if normalized not in deduplicated:
        deduplicated[normalized] = (symbol, position, fx_rate, mark_price, position_value)
    else:
        existing = deduplicated[normalized]
        existing_value = existing[4]
        if position_value > existing_value:
            deduplicated[normalized] = (symbol, position, fx_rate, mark_price, position_value)

print("Deduplicated holdings:")
for norm, (sym, pos, fx, mp, pv) in deduplicated.items():
    print(f"  {norm}: {sym} - {pos} shares, value=${pv:.2f}")

print(f"\nTotal unique holdings: {len(deduplicated)}")



