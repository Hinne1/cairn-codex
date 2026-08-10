using System.Text.Json;
using System.Text.Json.Serialization;

const int ProtocolVersion = 1;
var jsonOptions = new JsonSerializerOptions
{
    PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
};

string? line;
while ((line = Console.ReadLine()) is not null)
{
    HelperResponse response;

    try
    {
        var request = JsonSerializer.Deserialize<HelperRequest>(line, jsonOptions)
            ?? throw new JsonException("Request body is empty.");

        response = request.Method switch
        {
            "health" => HelperResponse.Success(request.Id, new
            {
                service = "CairnCodex.GrimDawn",
                protocolVersion = ProtocolVersion,
                mode = "read-only"
            }),
            _ => HelperResponse.Failure(request.Id, "method_not_found", $"Unknown method: {request.Method}")
        };
    }
    catch (Exception exception) when (exception is JsonException or NotSupportedException)
    {
        response = HelperResponse.Failure(null, "invalid_request", exception.Message);
    }

    Console.WriteLine(JsonSerializer.Serialize(response, jsonOptions));
}

internal sealed record HelperRequest(string Id, string Method, JsonElement? Params);

internal sealed record HelperError(string Code, string Message);

internal sealed record HelperResponse(string? Id, object? Result, HelperError? Error)
{
    public static HelperResponse Success(string id, object result) => new(id, result, null);

    public static HelperResponse Failure(string? id, string code, string message) =>
        new(id, null, new HelperError(code, message));
}
