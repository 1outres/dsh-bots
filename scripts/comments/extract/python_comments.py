import io
import json
import sys
import tokenize


def comments_of(source):
    tokens = tokenize.generate_tokens(io.StringIO(source).readline)
    return [
        {"line": token.start[0], "column": token.start[1], "text": token.string}
        for token in tokens
        if token.type == tokenize.COMMENT
    ]


def main():
    results = []
    for file in json.load(sys.stdin):
        try:
            results.append(comments_of(file["source"]))
        except (tokenize.TokenError, SyntaxError) as error:
            sys.stderr.write(f"{file['path']}: {error}\n")
            sys.exit(1)
    json.dump(results, sys.stdout)


main()
