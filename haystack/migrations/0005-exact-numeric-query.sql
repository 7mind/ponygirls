-- Exact mathematical comparison against an admitted query number lexeme.
-- Query exponents can exceed PostgreSQL numeric's range. Never cast that query
-- literal to numeric/jsonb or allocate exponent-sized strings. The stored side
-- is already JSONB numeric; normalization compares signs, magnitudes and digits.
CREATE FUNCTION haystack_compare_number(value jsonb, literal text)
RETURNS integer LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  parts text[];
  inputs text[] := ARRAY[value::text, literal];
  signs integer[] := ARRAY[0,0];
  magnitudes integer[] := ARRAY[0,0];
  coefficients text[] := ARRAY['',''];
  coefficient text;
  exponent_text text;
  exponent_value integer;
  fraction_size integer;
  width integer;
  result integer;
  n integer;
BEGIN
  IF value IS NULL OR jsonb_typeof(value) <> 'number' THEN RETURN NULL; END IF;
  FOR n IN 1..2 LOOP
    parts := regexp_match(inputs[n], '^(-?)([0-9]+)(?:\.([0-9]+))?(?:[eE]([+-]?[0-9]+))?$');
    IF parts IS NULL THEN RETURN NULL; END IF;
    coefficient := ltrim(parts[2] || COALESCE(parts[3], ''), '0');
    IF coefficient = '' THEN
      signs[n] := 0;
      coefficients[n] := '';
      magnitudes[n] := 0;
    ELSE
      signs[n] := CASE WHEN parts[1] = '-' THEN -1 ELSE 1 END;
      fraction_size := length(COALESCE(parts[3], ''));
      -- The application parser has already bounded exponent value to999999.
      -- Canonicalize arbitrarily many leading exponent zeros before int cast.
      exponent_text := COALESCE(parts[4], '0');
      exponent_value := (CASE WHEN left(exponent_text,1)='-' THEN -1 ELSE 1 END) *
        COALESCE(NULLIF(ltrim(ltrim(exponent_text,'+-'),'0'),''),'0')::integer;
      coefficients[n] := coefficient;
      magnitudes[n] := length(coefficient) + exponent_value - fraction_size;
    END IF;
  END LOOP;
  IF signs[1] <> signs[2] THEN RETURN CASE WHEN signs[1] < signs[2] THEN -1 ELSE 1 END; END IF;
  IF signs[1] = 0 THEN RETURN 0; END IF;
  IF magnitudes[1] <> magnitudes[2] THEN
    RETURN (CASE WHEN magnitudes[1] < magnitudes[2] THEN -1 ELSE 1 END) * signs[1];
  END IF;
  width := greatest(length(coefficients[1]), length(coefficients[2]));
  IF rpad(coefficients[1],width,'0') COLLATE "C" = rpad(coefficients[2],width,'0') COLLATE "C" THEN RETURN 0; END IF;
  result := CASE WHEN rpad(coefficients[1],width,'0') COLLATE "C" < rpad(coefficients[2],width,'0') COLLATE "C" THEN -1 ELSE 1 END;
  RETURN result * signs[1];
END;
$$;

-- Canonical qualified-ID ordering for bounded ID completion, on raw components.
-- Bytes are UTF8; every non-RFC3986-unreserved byte is escaped exactly once.
CREATE FUNCTION haystack_encode_component(component text)
RETURNS text LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE bytes bytea := convert_to(component,'UTF8'); result text := ''; n integer; b integer;
BEGIN
  FOR n IN 0..length(bytes)-1 LOOP
    b := get_byte(bytes,n);
    IF b BETWEEN 48 AND 57 OR b BETWEEN 65 AND 90 OR b BETWEEN 97 AND 122 OR b IN (45,46,95,126) THEN
      result := result || chr(b);
    ELSE result := result || '%' || upper(lpad(to_hex(b),2,'0')); END IF;
  END LOOP;
  RETURN result;
END;
$$;
