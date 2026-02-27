package core

import (
	"encoding/binary"
	"fmt"
	"io"
)

// EventStreamFrame represents a single parsed AWS event stream frame.
type EventStreamFrame struct {
	EventType string
	Payload   []byte
	Headers   map[string]string
}

// EventStreamParser reads binary AWS event stream frames from an io.Reader.
type EventStreamParser struct {
	reader io.Reader
	buf    []byte
}

// NewEventStreamParser creates a parser that reads from r.
func NewEventStreamParser(r io.Reader) *EventStreamParser {
	return &EventStreamParser{reader: r, buf: make([]byte, 0, 4096)}
}

// NextFrame reads and returns the next complete event stream frame.
// Returns io.EOF when no more frames are available.
func (p *EventStreamParser) NextFrame() (*EventStreamFrame, error) {
	if err := p.ensureBuffered(12); err != nil {
		return nil, err
	}
	totalLength := int(binary.BigEndian.Uint32(p.buf[0:4]))
	if totalLength < 16 {
		return nil, fmt.Errorf("eventstream: invalid total length %d", totalLength)
	}
	if err := p.ensureBuffered(totalLength); err != nil {
		return nil, fmt.Errorf("eventstream: incomplete frame: %w", err)
	}

	headersLength := int(binary.BigEndian.Uint32(p.buf[4:8]))
	// bytes 8..11 = prelude CRC (skip)

	headersEnd := 12 + headersLength
	if headersEnd > totalLength-4 {
		return nil, fmt.Errorf("eventstream: headers overflow frame")
	}

	headers := parseHeaders(p.buf[12:headersEnd])

	payloadEnd := totalLength - 4
	var payload []byte
	if payloadEnd > headersEnd {
		payload = make([]byte, payloadEnd-headersEnd)
		copy(payload, p.buf[headersEnd:payloadEnd])
	}

	p.buf = p.buf[totalLength:]

	return &EventStreamFrame{
		EventType: headers[":event-type"],
		Payload:   payload,
		Headers:   headers,
	}, nil
}

// ensureBuffered reads until at least n bytes are in the buffer.
func (p *EventStreamParser) ensureBuffered(n int) error {
	for len(p.buf) < n {
		tmp := make([]byte, 4096)
		read, err := p.reader.Read(tmp)
		if read > 0 {
			p.buf = append(p.buf, tmp[:read]...)
		}
		if err != nil {
			if err == io.EOF && len(p.buf) >= n {
				return nil
			}
			return err
		}
	}
	return nil
}

// parseHeaders parses the binary header block of an AWS event stream frame.
// Header format: [nameLen:1][name:N][type:1][...value...]
// Type 7 = string: [valueLen:2][value:M]
func parseHeaders(data []byte) map[string]string {
	result := make(map[string]string)
	offset := 0
	for offset < len(data) {
		nameLen := int(data[offset])
		offset++
		if offset+nameLen > len(data) {
			break
		}
		name := string(data[offset : offset+nameLen])
		offset += nameLen
		if offset >= len(data) {
			break
		}
		valueType := data[offset]
		offset++

		switch valueType {
		case 7: // string
			if offset+2 > len(data) {
				return result
			}
			vLen := int(binary.BigEndian.Uint16(data[offset : offset+2]))
			offset += 2
			if offset+vLen > len(data) {
				return result
			}
			result[name] = string(data[offset : offset+vLen])
			offset += vLen
		case 6: // bytes
			if offset+2 > len(data) {
				return result
			}
			vLen := int(binary.BigEndian.Uint16(data[offset : offset+2]))
			offset += 2 + vLen
		case 0, 1: // bool true/false
			// no value bytes
		case 2: // byte
			offset++
		case 3: // short
			offset += 2
		case 4: // int
			offset += 4
		case 5: // long
			offset += 8
		case 8: // timestamp
			offset += 8
		case 9: // uuid
			offset += 16
		default:
			return result
		}
	}
	return result
}

// readExactly reads exactly n bytes from r.
func readExactly(r io.Reader, n int) ([]byte, error) {
	buf := make([]byte, n)
	_, err := io.ReadFull(r, buf)
	if err != nil {
		return nil, err
	}
	return buf, nil
}
