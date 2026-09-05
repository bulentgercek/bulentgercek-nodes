class StringLineCount:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "text": ("STRING", {"forceInput": True, "multiline": True}),
                "skip_empty": ("BOOLEAN", {"default": True}),
            }
        }

    RETURN_TYPES = ("INT",)
    RETURN_NAMES = ("count",)
    FUNCTION = "count"
    CATEGORY = "bulentgercek/text"
    DESCRIPTION = "Counts the lines in a string (optionally skipping blank lines)."

    def count(self, text, skip_empty):
        lines = text.splitlines()
        if skip_empty:
            lines = [ln for ln in lines if ln.strip()]
        return (len(lines),)


NODE_CLASS_MAPPINGS = {
    "StringLineCount": StringLineCount,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "StringLineCount": "String Line Count",
}
