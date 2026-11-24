class RpcError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def invalid_params(message: str) -> RpcError:
    return RpcError("invalid_params", message)


def stale_element(element_id: str) -> RpcError:
    return RpcError("stale_element", f"element {element_id} is not in a current snapshot; take a new desktop_tree or desktop_find")


def unsupported(message: str) -> RpcError:
    return RpcError("unsupported", message)
