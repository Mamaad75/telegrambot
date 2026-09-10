using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Serialization;

namespace Bahoosh.Analytics.Contracts.V4;

public sealed record AiAnalyzeRequest(
    [property: JsonPropertyName("site_id")] string SiteId,
    [property: JsonPropertyName("from")] string From,
    [property: JsonPropertyName("to")] string To,
    [property: JsonPropertyName("focus")] string Focus,
    [property: JsonPropertyName("origin")] string Origin);

public sealed record AiRecommendation(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("title")] string Title,
    [property: JsonPropertyName("summary")] string Summary,
    [property: JsonPropertyName("rationale")] string? Rationale,
    [property: JsonPropertyName("priority")] string Priority,
    [property: JsonPropertyName("confidence")] int Confidence,
    [property: JsonPropertyName("impact")] string? Impact,
    [property: JsonPropertyName("evidence")] IReadOnlyList<string> Evidence,
    [property: JsonPropertyName("action")] AiAction? Action,
    [property: JsonPropertyName("created_at")] DateTimeOffset CreatedAt,
    [property: JsonPropertyName("model_run_id")] string ModelRunId);

public sealed record AiAction(
    [property: JsonPropertyName("type")] string Type,
    [property: JsonPropertyName("payload")] IReadOnlyDictionary<string, object?> Payload,
    [property: JsonPropertyName("version")] int Version = 1);

public sealed record AiCallback(
    [property: JsonPropertyName("recommendations")] IReadOnlyList<AiRecommendation> Recommendations);

public sealed record FunnelDefinition(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("name")] string Name,
    [property: JsonPropertyName("steps")] IReadOnlyList<FunnelStep> Steps);

public sealed record FunnelStep(
    [property: JsonPropertyName("label")] string Label,
    [property: JsonPropertyName("event_type")] string EventType,
    [property: JsonPropertyName("path")] string? Path);

public sealed record FunnelReportStep(
    [property: JsonPropertyName("label")] string Label,
    [property: JsonPropertyName("users")] long Users,
    [property: JsonPropertyName("conversion_rate")] decimal ConversionRate,
    [property: JsonPropertyName("dropoff_rate")] decimal DropoffRate);

public sealed record JourneyPath(
    [property: JsonPropertyName("users")] long Users,
    [property: JsonPropertyName("conversion_rate")] decimal ConversionRate,
    [property: JsonPropertyName("nodes")] IReadOnlyList<string> Nodes);

public static class BahooshWebhookSigner
{
    public static string Sign(string secret, long unixTimestamp, string rawJson)
    {
        var key = Encoding.UTF8.GetBytes(secret);
        var payload = Encoding.UTF8.GetBytes($"{unixTimestamp}.{rawJson}");
        using var hmac = new HMACSHA256(key);
        return Convert.ToHexString(hmac.ComputeHash(payload)).ToLowerInvariant();
    }

    public static bool Verify(string secret, long unixTimestamp, string rawJson, string signature)
    {
        var expected = Sign(secret, unixTimestamp, rawJson);
        var a = Encoding.UTF8.GetBytes(expected);
        var b = Encoding.UTF8.GetBytes(signature.Trim().ToLowerInvariant());
        return a.Length == b.Length && CryptographicOperations.FixedTimeEquals(a, b);
    }
}
