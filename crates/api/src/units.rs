use alloy::primitives::U256;

pub fn parse_units(input: &str, decimals: u32) -> Result<U256, String> {
    let s = input.trim();
    if s.is_empty() || s.starts_with('-') || s.starts_with('+') {
        return Err("Enter an amount greater than zero.".into());
    }
    let (whole, frac) = match s.split_once('.') {
        Some((w, f)) => (w, f),
        None => (s, ""),
    };
    if whole.is_empty() && frac.is_empty() {
        return Err("Enter an amount greater than zero.".into());
    }
    if !whole.chars().all(|c| c.is_ascii_digit()) || !frac.chars().all(|c| c.is_ascii_digit()) {
        return Err("Amount must be a decimal number.".into());
    }
    if frac.len() > decimals as usize {
        return Err(format!("Use at most {decimals} decimal places."));
    }
    let whole = if whole.is_empty() { "0" } else { whole };
    let mut value = U256::from_str_radix(whole, 10).map_err(|_| "Amount is too large.".to_string())?;
    let scale = U256::from(10u64).pow(U256::from(decimals));
    value = value.checked_mul(scale).ok_or("Amount is too large.")?;
    if !frac.is_empty() {
        let padded = format!("{frac:0<width$}", width = decimals as usize);
        let extra = U256::from_str_radix(&padded, 10).map_err(|_| "Amount is too large.".to_string())?;
        value = value.checked_add(extra).ok_or("Amount is too large.")?;
    }
    if value.is_zero() {
        return Err("Enter an amount greater than zero.".into());
    }
    Ok(value)
}

pub fn format_units(value: U256, decimals: u32) -> String {
    let scale = U256::from(10u64).pow(U256::from(decimals));
    let whole = value / scale;
    let frac = value % scale;
    if frac.is_zero() {
        return whole.to_string();
    }
    let mut frac_str = format!("{frac:0>width$}", width = decimals as usize);
    while frac_str.ends_with('0') {
        frac_str.pop();
    }
    format!("{whole}.{frac_str}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_whole_and_fraction() {
        let v = parse_units("1000", 18).unwrap();
        assert_eq!(format_units(v, 18), "1000");
        let v = parse_units("1.5", 18).unwrap();
        assert_eq!(format_units(v, 18), "1.5");
        assert!(parse_units("0", 18).is_err());
        assert!(parse_units("1.0000000000000000001", 18).is_err());
    }
}
