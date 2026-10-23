import socket

import pytest
from pytest_socket import SocketBlockedError


@pytest.mark.filterwarnings("ignore:A test tried to use socket:UserWarning")
def test_outbound_connections_are_blocked():
    # Fails if --disable-socket is dropped from pytest's addopts.
    # 192.0.2.1 is TEST-NET-1, so no DNS lookup happens either way.
    with pytest.raises(SocketBlockedError):
        socket.create_connection(("192.0.2.1", 80), timeout=1)
