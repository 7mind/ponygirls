# Current generated haystack.api.Failure JSON shape. Transport failures are NOT
# wrapped in the retired Node { error: ... } envelope. The proxy codec check
# decodes this using the real current Baboon TypeScript codec.
{ }:
{
  unavailableJson = builtins.toJSON {
    code = "unavailable";
    message = "service unavailable";
    spans = [ ];
    currentRevision = null;
  };
}
